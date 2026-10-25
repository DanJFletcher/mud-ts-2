import { and, asc, desc, eq, gt, isNull, notLike, or, sql } from 'drizzle-orm';
import { db } from './db/client.js';
import { characters, durableEffects, gameEvents, roomChatMessages, worldSessions, roomCharacterStates } from './db/schema.js';
import { PLAYER_ROOM_MESSAGE_EFFECT } from './durable-effect-contracts.js';
import { measureDatabaseOperation } from './performance.js';

export const MAX_ROOM_CHAT_MESSAGE_LENGTH = 500;
const INITIAL_ROOM_CHAT_LIMIT = 50;
const ROOM_CHAT_POLL_LIMIT = 100;
export const NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX = 'world-npc-movement:';
type CharacterProjection = typeof roomCharacterStates.$inferSelect['state'];

export type RoomChatSpeakerType = 'player' | 'npc';

export type RoomChatMessage = Readonly<{
  id: number;
  roomId: string;
  speakerType: RoomChatSpeakerType;
  speakerName: string;
  text: string;
  createdAt: string;
  /** Returned only to the author so uncertain client submissions can reconcile by id. */
  submissionId?: string;
}>;

export type TerminalRoomEvent = RoomChatMessage;

type NewRoomChatMessage = Readonly<{
  worldInstanceId: string;
  playerId?: string | null;
  submissionId?: string | null;
  roomId: string;
  speakerType: RoomChatSpeakerType;
  speakerId: string;
  speakerName: string;
  text: string;
  sourceEffectId?: string | null;
}>;

type ChatTransaction = Pick<typeof db, 'select' | 'insert' | 'execute'>;

export type PlayerChatSubmission =
  | { kind: 'created' | 'duplicate'; message: RoomChatMessage; effectId?: string }
  | { kind: 'conflict' }
  | { kind: 'unavailable' };

function normalizeMessage(value: string): string {
  const message = value.trim();
  if (!message || message.length > MAX_ROOM_CHAT_MESSAGE_LENGTH) {
    throw new Error(`Room messages must be between 1 and ${MAX_ROOM_CHAT_MESSAGE_LENGTH} characters.`);
  }
  return message;
}

function toRoomChatMessage(
  row: typeof roomChatMessages.$inferSelect,
  viewerCharacterId?: string,
): RoomChatMessage {
  return {
    id: row.id,
    roomId: row.roomId,
    speakerType: row.speakerType,
    speakerName: row.speakerName,
    text: row.message,
    createdAt: row.createdAt.toISOString(),
    ...(row.speakerType === 'player' && row.speakerId === viewerCharacterId && row.submissionId
      ? { submissionId: row.submissionId }
      : {}),
  };
}

async function insertRoomChatMessage(tx: ChatTransaction, input: NewRoomChatMessage): Promise<RoomChatMessage> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(${input.worldInstanceId}), hashtext(${input.roomId}))`);
  const { text, ...messageFields } = input;
  const values = {
    ...messageFields,
    message: normalizeMessage(text),
    sourceEffectId: input.sourceEffectId ?? null,
  };
  const [row] = input.sourceEffectId
    ? await tx.insert(roomChatMessages).values(values)
      .onConflictDoNothing({ target: roomChatMessages.sourceEffectId }).returning()
    : await tx.insert(roomChatMessages).values(values).returning();
  if (!row && input.sourceEffectId) {
    const [existing] = await tx.select().from(roomChatMessages).where(and(
      eq(roomChatMessages.worldInstanceId, input.worldInstanceId),
      eq(roomChatMessages.sourceEffectId, input.sourceEffectId),
    )).limit(1);
    if (existing) return toRoomChatMessage(existing);
  }
  if (!row) throw new Error('Could not store the room message.');
  return toRoomChatMessage(row);
}

async function lockCharacterStream(tx: ChatTransaction, worldInstanceId: string, characterId: string): Promise<void> {
  // Uses the same advisory-lock key as PostgresEventStore.append so movement and
  // chat authorization have one well-defined ordering point.
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(${worldInstanceId}), hashtext(${characterId}))`);
}

async function readAuthorizedRoomCharacter(
  tx: ChatTransaction,
  input: Readonly<{ worldInstanceId: string; playerId: string; characterId: string; roomId: string }>,
): Promise<CharacterProjection | undefined> {
  await tx.execute(sql`
    SELECT id FROM world_sessions
    WHERE player_id = ${input.playerId}
      AND world_instance_id = ${input.worldInstanceId}
      AND character_id = ${input.characterId}
    FOR UPDATE`);
  const [session] = await tx.select({ id: worldSessions.id }).from(worldSessions).where(and(
    eq(worldSessions.playerId, input.playerId),
    eq(worldSessions.worldInstanceId, input.worldInstanceId),
    eq(worldSessions.characterId, input.characterId),
  )).limit(1);
  if (!session) return undefined;

  await tx.execute(sql`
    SELECT id FROM characters
    WHERE id = ${input.characterId}
      AND player_id = ${input.playerId}
      AND world_instance_id = ${input.worldInstanceId}
      AND archived_at IS NULL
    FOR UPDATE`);
  const [characterRow] = await tx.select({ id: characters.id }).from(characters).where(and(
    eq(characters.id, input.characterId),
    eq(characters.playerId, input.playerId),
    eq(characters.worldInstanceId, input.worldInstanceId),
    isNull(characters.archivedAt),
  )).limit(1);
  if (!characterRow) return undefined;

  const [head] = await tx.select({ revision: gameEvents.streamVersion }).from(gameEvents).where(and(
    eq(gameEvents.worldInstanceId, input.worldInstanceId),
    eq(gameEvents.streamId, input.characterId),
  )).orderBy(desc(gameEvents.streamVersion)).limit(1);
  const [current] = await tx.select().from(roomCharacterStates).where(and(
    eq(roomCharacterStates.characterId, input.characterId),
    eq(roomCharacterStates.worldInstanceId, input.worldInstanceId),
  )).limit(1);
  // The stream lock remains held: a move cannot race this authorization.
  // Fail closed on an old writer or an incomplete backfill.
  if (!current || current.schemaVersion !== 1 || current.revision !== head?.revision) return undefined;
  const projection = current.state;
  if (!projection || projection.archived || projection.locationId !== input.roomId) return undefined;
  return projection;
}

async function findSubmission(
  tx: ChatTransaction,
  input: Readonly<{ worldInstanceId: string; playerId: string; submissionId: string }>,
) {
  const [existing] = await tx.select().from(roomChatMessages).where(and(
    eq(roomChatMessages.worldInstanceId, input.worldInstanceId),
    eq(roomChatMessages.playerId, input.playerId),
    eq(roomChatMessages.submissionId, input.submissionId),
  )).limit(1);
  return existing;
}

async function findRoomChatEffectId(
  tx: ChatTransaction,
  input: Readonly<{ worldInstanceId: string; playerId: string; submissionId: string }>,
): Promise<string | undefined> {
  const [effect] = await tx.select({ id: durableEffects.id }).from(durableEffects).where(eq(
    durableEffects.dedupeKey,
    `room-chat:${input.worldInstanceId}:${input.playerId}:${input.submissionId}`,
  )).limit(1);
  return effect?.id;
}

export async function createPlayerRoomChatMessage(input: Readonly<{
  worldInstanceId: string;
  playerId: string;
  roomId: string;
  characterId: string;
  clientMessageId: string;
  text: string;
}>): Promise<PlayerChatSubmission> {
  const normalizedText = normalizeMessage(input.text);
  return measureDatabaseOperation('room_chat.player_message_submit', () => db.transaction(async (tx) => {
    await lockCharacterStream(tx, input.worldInstanceId, input.characterId);

    const existing = await findSubmission(tx, {
      worldInstanceId: input.worldInstanceId,
      playerId: input.playerId,
      submissionId: input.clientMessageId,
    });
    if (existing) {
      const isSameSubmission = existing.roomId === input.roomId &&
        existing.speakerId === input.characterId &&
        existing.message === normalizedText;
      return isSameSubmission
        ? {
          kind: 'duplicate',
          message: toRoomChatMessage(existing),
          effectId: await findRoomChatEffectId(tx, {
            worldInstanceId: input.worldInstanceId,
            playerId: input.playerId,
            submissionId: input.clientMessageId,
          }),
        }
        : { kind: 'conflict' };
    }

    const character = await readAuthorizedRoomCharacter(tx, input);
    if (!character) return { kind: 'unavailable' };

    const candidate = {
      worldInstanceId: input.worldInstanceId,
      playerId: input.playerId,
      submissionId: input.clientMessageId,
      roomId: input.roomId,
      speakerType: 'player' as const,
      speakerId: input.characterId,
      speakerName: character.name,
      text: normalizedText,
    };
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${input.worldInstanceId}), hashtext(${input.roomId}))`);
    const [row] = await tx.insert(roomChatMessages).values({
      worldInstanceId: candidate.worldInstanceId,
      playerId: candidate.playerId,
      submissionId: candidate.submissionId,
      roomId: candidate.roomId,
      speakerType: candidate.speakerType,
      speakerId: candidate.speakerId,
      speakerName: candidate.speakerName,
      message: candidate.text,
      sourceEffectId: null,
    }).onConflictDoNothing().returning();
    if (row) {
      const effectId = globalThis.crypto.randomUUID();
      await tx.insert(durableEffects).values({
        id: effectId,
        worldInstanceId: input.worldInstanceId,
        sourceStreamId: input.characterId,
        causationCommandId: input.clientMessageId,
        effectType: PLAYER_ROOM_MESSAGE_EFFECT,
        effectVersion: 1,
        payload: { roomChatMessageId: row.id },
        dedupeKey: `room-chat:${input.worldInstanceId}:${input.playerId}:${input.clientMessageId}`,
      });
      return { kind: 'created', message: toRoomChatMessage(row), effectId };
    }

    const racedSubmission = await findSubmission(tx, {
      worldInstanceId: input.worldInstanceId,
      playerId: input.playerId,
      submissionId: input.clientMessageId,
    });
    if (!racedSubmission) throw new Error('Chat submission conflicted without a stored receipt.');
    const isSameSubmission = racedSubmission.roomId === input.roomId &&
      racedSubmission.speakerId === input.characterId &&
      racedSubmission.message === normalizedText;
    return isSameSubmission
      ? {
        kind: 'duplicate',
        message: toRoomChatMessage(racedSubmission),
        effectId: await findRoomChatEffectId(tx, {
          worldInstanceId: input.worldInstanceId,
          playerId: input.playerId,
          submissionId: input.clientMessageId,
        }),
      }
      : { kind: 'conflict' };
  }));
}

/**
 * Server-side entry point for NPC room announcements. Never expose NPC identity
 * selection through player-facing HTTP endpoints.
 */
export async function publishNpcRoomMessage(input: Readonly<{
  worldInstanceId: string;
  roomId: string;
  npcId: string;
  npcName: string;
  text: string;
  sourceEffectId?: string;
}>): Promise<RoomChatMessage> {
  return db.transaction(async (tx) => insertRoomChatMessage(tx, {
    worldInstanceId: input.worldInstanceId,
    playerId: null,
    submissionId: null,
    roomId: input.roomId,
    speakerType: 'npc',
    speakerId: input.npcId,
    speakerName: input.npcName,
    text: input.text,
    sourceEffectId: input.sourceEffectId,
  }));
}

export async function getRoomChatMessageById(messageId: number): Promise<RoomChatMessage | undefined> {
  const [row] = await measureDatabaseOperation('room_chat.message_id_lookup', () =>
    db.select().from(roomChatMessages).where(eq(roomChatMessages.id, messageId)).limit(1));
  return row ? toRoomChatMessage(row) : undefined;
}

export async function getRoomChatMessageBySourceEffectId(sourceEffectId: string): Promise<RoomChatMessage | undefined> {
  const [row] = await measureDatabaseOperation('room_chat.effect_message_lookup', () =>
    db.select().from(roomChatMessages).where(eq(roomChatMessages.sourceEffectId, sourceEffectId)).limit(1));
  return row ? toRoomChatMessage(row) : undefined;
}

export async function listRoomChatMessages(input: Readonly<{
  worldInstanceId: string;
  playerId: string;
  characterId: string;
  roomId: string;
  afterId?: number;
}>): Promise<{
  messages: readonly RoomChatMessage[];
  terminalEvents: readonly TerminalRoomEvent[];
  cursor: number;
} | undefined> {
  return measureDatabaseOperation('room_chat.authorized_history_read', () => db.transaction(async (tx) => {
    await lockCharacterStream(tx, input.worldInstanceId, input.characterId);
    const character = await readAuthorizedRoomCharacter(tx, input);
    if (!character) return undefined;

    const conditions = [
      eq(roomChatMessages.worldInstanceId, input.worldInstanceId),
      eq(roomChatMessages.roomId, input.roomId),
    ];

    if (input.afterId !== undefined) {
      const rows = await tx.select().from(roomChatMessages)
        .where(and(...conditions, gt(roomChatMessages.id, input.afterId)))
        .orderBy(asc(roomChatMessages.id))
        .limit(ROOM_CHAT_POLL_LIMIT);
      const movementRows = rows.filter((row) =>
        row.sourceEffectId?.startsWith(NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX));
      return {
        messages: rows
          .filter((row) => !row.sourceEffectId?.startsWith(NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX))
          .map((row) => toRoomChatMessage(row, input.characterId)),
        terminalEvents: movementRows.map(toRoomChatMessage),
        cursor: rows.at(-1)?.id ?? input.afterId,
      };
    }

    const [latest] = await tx.select({
      id: sql<number>`coalesce(max(${roomChatMessages.id}), 0)`,
    }).from(roomChatMessages).where(and(...conditions));
    const rows = await tx.select().from(roomChatMessages)
      .where(and(
        ...conditions,
        or(
          isNull(roomChatMessages.sourceEffectId),
          notLike(roomChatMessages.sourceEffectId, `${NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX}%`),
        ),
      ))
      .orderBy(desc(roomChatMessages.id))
      .limit(INITIAL_ROOM_CHAT_LIMIT);
    return {
      messages: rows.reverse().map((row) => toRoomChatMessage(row, input.characterId)),
      terminalEvents: [],
      cursor: Number(latest?.id ?? 0),
    };
  }));
}
