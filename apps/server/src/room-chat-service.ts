import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { db } from './db/client.js';
import { roomChatMessages } from './db/schema.js';

export const MAX_ROOM_CHAT_MESSAGE_LENGTH = 500;
const INITIAL_ROOM_CHAT_LIMIT = 50;
const ROOM_CHAT_POLL_LIMIT = 100;

export type RoomChatSpeakerType = 'player' | 'npc';

export type RoomChatMessage = Readonly<{
  id: number;
  roomId: string;
  speakerType: RoomChatSpeakerType;
  speakerName: string;
  text: string;
  createdAt: string;
}>;

type NewRoomChatMessage = Readonly<{
  worldInstanceId: string;
  roomId: string;
  speakerType: RoomChatSpeakerType;
  speakerId: string;
  speakerName: string;
  text: string;
}>;

function normalizeMessage(value: string): string {
  const message = value.trim();
  if (!message || message.length > MAX_ROOM_CHAT_MESSAGE_LENGTH) {
    throw new Error(`Room messages must be between 1 and ${MAX_ROOM_CHAT_MESSAGE_LENGTH} characters.`);
  }
  return message;
}

function toRoomChatMessage(row: typeof roomChatMessages.$inferSelect): RoomChatMessage {
  return {
    id: row.id,
    roomId: row.roomId,
    speakerType: row.speakerType,
    speakerName: row.speakerName,
    text: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

async function insertRoomChatMessage(input: NewRoomChatMessage): Promise<RoomChatMessage> {
  const { text, ...messageFields } = input;
  const [row] = await db.insert(roomChatMessages).values({
    ...messageFields,
    message: normalizeMessage(text),
  }).returning();
  if (!row) throw new Error('Could not store the room message.');
  return toRoomChatMessage(row);
}

export async function createPlayerRoomChatMessage(input: Readonly<{
  worldInstanceId: string;
  roomId: string;
  characterId: string;
  characterName: string;
  text: string;
}>): Promise<RoomChatMessage> {
  return insertRoomChatMessage({
    worldInstanceId: input.worldInstanceId,
    roomId: input.roomId,
    speakerType: 'player',
    speakerId: input.characterId,
    speakerName: input.characterName,
    text: input.text,
  });
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
}>): Promise<RoomChatMessage> {
  return insertRoomChatMessage({
    worldInstanceId: input.worldInstanceId,
    roomId: input.roomId,
    speakerType: 'npc',
    speakerId: input.npcId,
    speakerName: input.npcName,
    text: input.text,
  });
}

export async function listRoomChatMessages(input: Readonly<{
  worldInstanceId: string;
  roomId: string;
  afterId?: number;
}>): Promise<readonly RoomChatMessage[]> {
  const conditions = [
    eq(roomChatMessages.worldInstanceId, input.worldInstanceId),
    eq(roomChatMessages.roomId, input.roomId),
  ];

  if (input.afterId !== undefined) {
    const rows = await db.select().from(roomChatMessages)
      .where(and(...conditions, gt(roomChatMessages.id, input.afterId)))
      .orderBy(asc(roomChatMessages.id))
      .limit(ROOM_CHAT_POLL_LIMIT);
    return rows.map(toRoomChatMessage);
  }

  const rows = await db.select().from(roomChatMessages)
    .where(and(...conditions))
    .orderBy(desc(roomChatMessages.id))
    .limit(INITIAL_ROOM_CHAT_LIMIT);
  return rows.reverse().map(toRoomChatMessage);
}
