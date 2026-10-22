import {
  CharacterProjectionSchema,
  CommandReceiptSchema,
  CreateCharacterCommandSchema,
  RenameCharacterCommandSchema,
  ArchiveCharacterCommandSchema,
  RestoreCharacterCommandSchema,
  LocationDescribeQuerySchema,
  LocationGroupsListQuerySchema,
  LocationGroupsListProjectionSchema,
  NpcDialogueChoiceCommandSchema,
  NpcTalkQuerySchema,
  ObjectInspectQuerySchema,
  MoveCharacterCommandSchema,
  RoadStepCommandSchema,
  TakeCharacterItemCommandSchema,
  DropCharacterItemCommandSchema,
  EquipCharacterItemCommandSchema,
  UnequipCharacterItemCommandSchema,
  UseCharacterItemCommandSchema,
  CharacterItemUsedEventSchema,
  ReadCharacterObjectCommandSchema,
  CharacterObjectReadEventSchema,
  IdSchema,
  LocationProjectionSchema,
  RoomPresenceProjectionSchema,
  QuestJournalSchema,
  WorldMapProjectionSchema,
  ObjectInspectionProjectionSchema,
  NpcDialogueProjectionSchema,
  MerchantCatalogProjectionSchema,
  MerchantCatalogQuerySchema,
  MerchantPurchaseCommandSchema,
  InnRestCommandSchema,
  CombatActionCommandSchema,
  InteractionInboxSchema,
  InteractionRequestCommandSchema,
  InteractionRespondCommandSchema,
  PvpCombatActionCommandSchema,
  PartyCreateCommandSchema,
  PartyJoinCommandSchema,
  PartyLeaveCommandSchema,
  PartyCloseCommandSchema,
  PartyListQuerySchema,
  PartyInfoQuerySchema,
  PartyListProjectionSchema,
  PartyInfoProjectionSchema,
  PartyQuestStartCommandSchema,
  PartyQuestJournalQuerySchema,
  PartyQuestJournalSchema,
  TeamCombatActionCommandSchema,
  TeamCombatActionSchema,
  TeamCombatInfoProjectionSchema,
  TeamCombatInfoQuerySchema,
  TeamCombatStartCommandSchema,
  type LocationProjection,
  type RoomPresenceProjection,
  type NpcDialogueProjection,
  type ReadableObjectProjection,
  type ObjectInspectionProjection,
  type MerchantCatalogProjection,
  type InteractionInbox,
  type CombatActionId,
  type EquipmentSlot,
  type PartyListProjection,
  type PartyInfoProjection,
  type PartyQuestJournal,
  type TeamCombatInfoProjection,
} from '@mudd/contracts';
import { z } from 'zod';

export const GameSnapshotSchema = z.object({
  player: z.object({ id: IdSchema, displayName: z.string() }),
  character: CharacterProjectionSchema.optional(),
  location: LocationProjectionSchema.optional(),
  map: WorldMapProjectionSchema.optional(),
  questJournal: QuestJournalSchema.optional(),
});
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

export const CharacterRosterSnapshotSchema = z.object({
  player: z.object({ id: IdSchema, displayName: z.string() }),
  characters: z.array(CharacterProjectionSchema.extend({ locationTitle: z.string() })),
  activeWorldSession: z.object({ id: IdSchema, characterId: IdSchema }).nullable(),
});
export type CharacterRosterSnapshot = z.infer<typeof CharacterRosterSnapshotSchema>;
const GuestSessionResponseSchema = z.object({
  player: z.object({ id: IdSchema, displayName: z.string() }),
});

export const CommandResponseSchema = z.object({
  receipt: CommandReceiptSchema,
  streamId: IdSchema.optional(),
  events: z.array(z.object({ type: z.string().min(1), payload: z.unknown().optional() })).optional(),
});
export type CommandResponse = z.infer<typeof CommandResponseSchema>;

const WorldSessionResponseSchema = z.object({ sessionId: IdSchema, characterId: IdSchema });
const queryResultSchema = <T extends z.ZodType>(value: T) => z.object({
  ok: z.boolean(),
  value: value.optional(),
  message: z.string().optional(),
  code: z.string().optional(),
});

export interface ClientOptions {
  worldInstanceId: string;
  fetcher?: typeof fetch;
}

export class MuddHttpClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
  }

  async getGame(): Promise<GameSnapshot> {
    return this.request('/api/game', {}, GameSnapshotSchema);
  }

  async heartbeatWorldSession(): Promise<RoomPresenceProjection> {
    return this.request('/api/world-session/heartbeat', {
      method: 'POST',
    }, RoomPresenceProjectionSchema);
  }

  async getCharacters(): Promise<CharacterRosterSnapshot> {
    return this.request('/api/characters', {}, CharacterRosterSnapshotSchema);
  }

  async createGuestSession(): Promise<{ player: { id: string; displayName: string } }> {
    return this.request('/api/guest-session', {
      method: 'POST',
    }, GuestSessionResponseSchema);
  }

  async joinWorld(characterId: string): Promise<{ sessionId: string; characterId: string }> {
    return this.request('/api/world-session', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }, WorldSessionResponseSchema);
  }

  async leaveWorld(): Promise<void> {
    const response = await this.fetcher('/api/world-session', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : undefined;
      throw new Error(message ?? `Request failed (${response.status}).`);
    }
  }

  async createCharacter(name: string, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    const command = CreateCharacterCommandSchema.parse({
      type: 'character.create',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      payload: { name },
    });
    return this.send(command);
  }

  async renameCharacter(
    characterId: string,
    name: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const command = RenameCharacterCommandSchema.parse({
      type: 'character.rename',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { name },
    });
    return this.send(command);
  }

  async archiveCharacter(
    characterId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const command = ArchiveCharacterCommandSchema.parse({
      type: 'character.archive',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: {},
    });
    return this.send(command);
  }

  async restoreCharacter(
    characterId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const command = RestoreCharacterCommandSchema.parse({
      type: 'character.restore',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: {},
    });
    return this.send(command);
  }

  async look(characterId: string, queryId = crypto.randomUUID()): Promise<LocationProjection> {
    const query = LocationDescribeQuerySchema.parse({
      type: 'location.describe',
      version: 1,
      queryId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: {},
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(LocationProjectionSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to inspect the current location.');
    return result.value;
  }

  async getLocationGroups(
    characterId: string,
    queryId = crypto.randomUUID(),
  ): Promise<z.infer<typeof LocationGroupsListProjectionSchema>> {
    const query = LocationGroupsListQuerySchema.parse({
      type: 'location.groups.list',
      version: 1,
      queryId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: {},
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(LocationGroupsListProjectionSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to list location groups.');
    return result.value;
  }

  async read(
    characterId: string,
    objectId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<ReadableObjectProjection> {
    const command = ReadCharacterObjectCommandSchema.parse({
      type: 'character.read',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { objectId },
    });
    const result = await this.send(command);
    const readEvent = result.events?.find((event) => event.type === 'character.object_read');
    const payload = CharacterObjectReadEventSchema.shape.payload.safeParse(readEvent?.payload);
    if (!payload.success) throw new Error('The read action completed without returning its text.');
    return { id: payload.data.objectId, label: payload.data.label, text: payload.data.text };
  }

  async inspect(characterId: string, objectId: string, queryId = crypto.randomUUID()): Promise<ObjectInspectionProjection> {
    const query = ObjectInspectQuerySchema.parse({
      type: 'object.inspect',
      version: 1,
      queryId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { objectId },
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(ObjectInspectionProjectionSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to inspect that object.');
    return result.value;
  }

  async talk(
    characterId: string,
    npcId: string,
    topic?: string,
    queryId = crypto.randomUUID(),
  ): Promise<NpcDialogueProjection> {
    const query = NpcTalkQuerySchema.parse({
      type: 'npc.talk',
      version: 1,
      queryId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { npcId, ...(topic ? { topic } : {}) },
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(NpcDialogueProjectionSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to speak to that person.');
    return result.value;
  }

  async getMerchantCatalog(
    characterId: string,
    merchantNpcId: string,
    queryId = crypto.randomUUID(),
  ): Promise<MerchantCatalogProjection> {
    const query = MerchantCatalogQuerySchema.parse({
      type: 'merchant.catalog',
      version: 1,
      queryId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { merchantNpcId },
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(MerchantCatalogProjectionSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to view this merchant’s goods.');
    return result.value;
  }

  async purchaseMerchantListing(
    characterId: string,
    merchantNpcId: string,
    listingId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const command = MerchantPurchaseCommandSchema.parse({
      type: 'merchant.purchase',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { merchantNpcId, listingId },
    });
    return this.send(command);
  }

  async restAtInn(
    characterId: string,
    innId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const command = InnRestCommandSchema.parse({
      type: 'inn.rest',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { innId },
    });
    return this.send(command);
  }

  async performCombatAction(
    characterId: string,
    action: CombatActionId,
    expectedVersion: number,
    target: { encounterId?: string; targetNpcId?: string; itemId?: string },
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const command = CombatActionCommandSchema.parse({
      type: 'combat.action',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { action, ...target },
    });
    return this.send(command);
  }

  async getInteractionInbox(): Promise<InteractionInbox> {
    return this.request('/api/interactions', { method: 'GET' }, InteractionInboxSchema);
  }

  async requestInteraction(
    characterId: string,
    recipientCharacterId: string,
    kind = 'pvp.challenge',
  ): Promise<CommandResponse> {
    return this.send(InteractionRequestCommandSchema.parse({
      type: 'interaction.request',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { kind, recipientCharacterId },
    }));
  }

  async respondToInteraction(
    characterId: string,
    requestId: string,
    response: 'accept' | 'decline',
  ): Promise<CommandResponse> {
    return this.send(InteractionRespondCommandSchema.parse({
      type: 'interaction.respond',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { requestId, response },
    }));
  }

  async performPvpAction(
    characterId: string,
    encounterId: string,
    action: 'attack' | 'defend' | 'flee' | 'use-item',
    itemId?: string,
  ): Promise<CommandResponse> {
    return this.send(PvpCombatActionCommandSchema.parse({
      type: 'pvp.action',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { encounterId, action, ...(itemId ? { itemId } : {}) },
    }));
  }

  async createParty(characterId: string): Promise<CommandResponse> {
    return this.send(PartyCreateCommandSchema.parse({
      type: 'party.create',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: {},
    }));
  }

  async joinParty(characterId: string, groupId: string): Promise<CommandResponse> {
    return this.send(PartyJoinCommandSchema.parse({
      type: 'party.join',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { groupId },
    }));
  }

  async leaveParty(characterId: string): Promise<CommandResponse> {
    return this.send(PartyLeaveCommandSchema.parse({
      type: 'party.leave',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: {},
    }));
  }

  async closeParty(characterId: string): Promise<CommandResponse> {
    return this.send(PartyCloseCommandSchema.parse({
      type: 'party.close',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: {},
    }));
  }

  async listParties(characterId: string): Promise<PartyListProjection> {
    const query = PartyListQuerySchema.parse({
      type: 'party.list',
      version: 1,
      queryId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: {},
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(PartyListProjectionSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to list parties.');
    return result.value;
  }

  async getPartyInfo(characterId: string, afterRevision?: number): Promise<PartyInfoProjection> {
    const query = PartyInfoQuerySchema.parse({
      type: 'party.info',
      version: 1,
      queryId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: afterRevision === undefined ? {} : { afterRevision },
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(PartyInfoProjectionSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to view party status.');
    return result.value;
  }

  async startPartyQuest(characterId: string, questId: string): Promise<CommandResponse> {
    return this.send(PartyQuestStartCommandSchema.parse({
      type: 'party.quest.start',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { questId },
    }));
  }

  async getPartyQuests(characterId: string): Promise<PartyQuestJournal> {
    const query = PartyQuestJournalQuerySchema.parse({
      type: 'party.quests',
      version: 1,
      queryId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: {},
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(PartyQuestJournalSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to view party quests.');
    return result.value;
  }

  async startTeamCombat(
    characterId: string,
    targetNpcId: string,
    expectedVersion: number,
  ): Promise<CommandResponse> {
    return this.send(TeamCombatStartCommandSchema.parse({
      type: 'team.combat.start',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { targetNpcId },
    }));
  }

  async performTeamCombatAction(
    characterId: string,
    encounterId: string,
    action: z.infer<typeof TeamCombatActionSchema>,
    options: { itemId?: string; targetParticipantId?: string } = {},
  ): Promise<CommandResponse> {
    return this.send(TeamCombatActionCommandSchema.parse({
      type: 'team.combat.action',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { encounterId, action, ...options },
    }));
  }

  async getTeamCombatInfo(characterId: string): Promise<TeamCombatInfoProjection> {
    const query = TeamCombatInfoQuerySchema.parse({
      type: 'team.combat.info',
      version: 1,
      queryId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: {},
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(TeamCombatInfoProjectionSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to view cooperative combat.');
    return result.value;
  }

  async chooseNpcDialogue(
    characterId: string,
    npcId: string,
    choiceId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const command = NpcDialogueChoiceCommandSchema.parse({
      type: 'npc.dialogue.choose',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { npcId, choiceId },
    });
    return this.send(command);
  }

  async move(characterId: string, exitId: string, expectedVersion: number, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    const command = MoveCharacterCommandSchema.parse({
      type: 'character.move',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { exitId },
    });
    return this.send(command);
  }

  async roadStep(characterId: string, exitId: string, expectedVersion: number, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    const command = RoadStepCommandSchema.parse({
      type: 'character.road.step',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { exitId },
    });
    return this.send(command);
  }

  async take(characterId: string, itemId: string, expectedVersion: number, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    const command = TakeCharacterItemCommandSchema.parse({
      type: 'character.take',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { itemId },
    });
    return this.send(command);
  }

  async drop(characterId: string, itemId: string, expectedVersion: number, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    const command = DropCharacterItemCommandSchema.parse({
      type: 'character.drop',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { itemId },
    });
    return this.send(command);
  }

  async equip(characterId: string, itemId: string, expectedVersion: number, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    const command = EquipCharacterItemCommandSchema.parse({
      type: 'character.equip',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { itemId },
    });
    return this.send(command);
  }

  async unequip(characterId: string, slot: EquipmentSlot, expectedVersion: number, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    const command = UnequipCharacterItemCommandSchema.parse({
      type: 'character.unequip',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { slot },
    });
    return this.send(command);
  }

  async use(
    characterId: string,
    itemId: string,
    targetId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<{ interactionId: string; response: string }> {
    const command = UseCharacterItemCommandSchema.parse({
      type: 'character.use',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { itemId, targetId },
    });
    const result = await this.send(command);
    const useEvent = result.events?.find((event) => event.type === 'character.item_used');
    const payload = CharacterItemUsedEventSchema.shape.payload.safeParse(useEvent?.payload);
    if (!payload.success) throw new Error('The use action completed without returning its response.');
    return { interactionId: payload.data.interactionId, response: payload.data.response };
  }

  private async send(command: unknown): Promise<CommandResponse> {
    const result = await this.request('/api/commands', {
      method: 'POST',
      body: JSON.stringify(command),
    }, CommandResponseSchema);
    if (!result.receipt.ok) throw new Error(result.receipt.message);
    return result;
  }

  private async request<Schema extends z.ZodTypeAny>(
    path: string,
    init: RequestInit,
    schema: Schema,
  ): Promise<z.output<Schema>> {
    const response = await this.fetcher(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : undefined;
      throw new Error(message ?? `Request failed (${response.status}).`);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new Error('The server returned an invalid response.');
    return parsed.data;
  }
}
