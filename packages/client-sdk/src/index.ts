import { CharacterClassCatalogSchema, ChooseCharacterClassCommandSchema } from '@mudd/contracts';
import {
  DailyBoardQuerySchema, DailyBoardProjectionSchema, DailyJobCommandSchema, GatherSupplyCommandSchema, SupplySourceDefinitionSchema,
  FishingCastCommandSchema, FishingAdvanceCommandSchema,
  StartWoodcuttingCommandSchema, AdvanceWoodcuttingCommandSchema,
  CraftingCatalogProjectionSchema, CraftingCatalogQuerySchema, CraftingCommandSchema,
  CharacterProjectionSchema,
  CharacterStatsProjectionSchema,
  CommandReceiptSchema,
  CreateCharacterCommandSchema,
  RenameCharacterCommandSchema,
  ArchiveCharacterCommandSchema,
  RestoreCharacterCommandSchema,
  LocationDescribeQuerySchema,
  LocationGroupsListQuerySchema,
  LocationGroupsListProjectionSchema,
  NpcDialogueChoiceCommandSchema,
  NpcDialogueRestartCommandSchema,
  NpcTalkQuerySchema,
  ObjectInspectQuerySchema,
  MoveCharacterCommandSchema,
  MovementResultProjectionSchema,
  RoadStepCommandSchema,
  TakeCharacterItemCommandSchema,
  DropCharacterItemCommandSchema,
  PutCharacterItemCommandSchema,
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
  CharacterRestCommandSchema,
  CharacterStandCommandSchema,
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
import { MuddRealtimeTransport } from './realtime.js';
import { PendingActionCoordinator } from './pending-actions.js';
export { MuddRealtimeTransport } from './realtime.js';
export {
  PendingActionCoordinator,
  type BeginPendingAction,
  type PendingAction,
  type PendingActionDetails,
  type PendingActionScope,
  type PendingActionState,
} from './pending-actions.js';

export const GameSnapshotSchema = z.object({
  availableFishingSpots: z.array(z.object({
    id: IdSchema,
    label: z.string().trim().min(1).max(120),
  }).strict()).optional(),
  availableWoodcuttingTrees: z.array(z.object({
    id: IdSchema,
    label: z.string().trim().min(1).max(120),
  }).strict()).optional(),
  dailyActivities: z.object({
    cycle: z.string(),
    boards: z.array(z.object({ id: z.string(), name: z.string() })),
    sources: z.array(SupplySourceDefinitionSchema),
  }).optional(),
  player: z.object({ id: IdSchema, displayName: z.string() }),
  character: CharacterProjectionSchema.optional(),
  stats: CharacterStatsProjectionSchema.optional(),
  currency: z.object({
    id: IdSchema,
    name: z.string().min(1),
    symbol: z.string().min(1),
  }).optional(),
  location: LocationProjectionSchema.optional(),
  map: WorldMapProjectionSchema.optional(),
  questJournal: QuestJournalSchema.optional(),
});
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

export const CharacterRosterSnapshotSchema = z.object({
  player: z.object({ id: IdSchema, displayName: z.string() }),
  characters: z.array(CharacterProjectionSchema.extend({
    locationTitle: z.string(),
    worldName: z.string().optional(),
    lastPlayedAt: z.string().datetime().nullable().optional(),
  })),
  activeWorldSession: z.object({ id: IdSchema, characterId: IdSchema }).nullable(),
  activeWorldSessions: z.array(z.object({
    worldInstanceId: z.string(),
    id: IdSchema,
    characterId: IdSchema,
  })).optional(),
});
export type CharacterRosterSnapshot = z.infer<typeof CharacterRosterSnapshotSchema>;
export const WorldListSchema = z.array(z.object({
  worldInstanceId: z.string().min(1),
  packId: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  introduction: z.array(z.string()).optional(),
  coverImage: z.string().optional(),
  classCatalog: CharacterClassCatalogSchema.optional(),
}));
export type WorldSummary = z.infer<typeof WorldListSchema>[number];
const GuestSessionResponseSchema = z.object({
  player: z.object({ id: IdSchema, displayName: z.string() }),
});

export const CommandResponseSchema = z.object({
  receipt: CommandReceiptSchema,
  streamId: IdSchema.optional(),
  events: z.array(z.object({ type: z.string().min(1), payload: z.unknown().optional() })).optional(),
  movementProjection: MovementResultProjectionSchema.optional(),
});
export type CommandResponse = z.infer<typeof CommandResponseSchema>;
const VersionedCharacterCommandSchema = z.object({
  characterId: IdSchema,
  expectedVersion: z.number().int().nonnegative(),
}).passthrough();

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
  /** Same-origin app mount path, e.g. /mudd. Defaults to the origin root. */
  basePath?: string;
}

type RequestTrace = {
  id: string;
  phase: 'command' | 'snapshot';
  commandType?: string;
};

export class MuddHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'MuddHttpError';
  }
}

export class MuddCommandError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'MuddCommandError';
  }
}

export class MuddHttpClient {
  private readonly fetcher: typeof fetch;
  private realtime: MuddRealtimeTransport;
  readonly pendingActions = new PendingActionCoordinator();

  constructor(private readonly options: ClientOptions) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.realtime = new MuddRealtimeTransport(() => {
      const url = new URL(`${this.options.basePath?.replace(/\/$/, '') ?? ''}/api/realtime`, globalThis.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('world', this.options.worldInstanceId);
      return url.toString();
    }, () => this.options.worldInstanceId);
  }
  watchRealtime(...args: Parameters<MuddRealtimeTransport['watch']>) { return this.realtime.watch(...args); }
  get realtimeConnectionState() { return this.realtime.connectionState; }

  setWorldInstanceId(worldInstanceId: string): void {
    if (!worldInstanceId.trim()) throw new Error('Choose a valid world.');
    this.pendingActions.clearWhere((action) => action.scope.worldInstanceId !== worldInstanceId);
    this.realtime.dispose();
    this.options.worldInstanceId = worldInstanceId;
  }

  async getWorlds(): Promise<WorldSummary[]> {
    return this.request('/api/worlds', {}, WorldListSchema);
  }

  async getGame(traceId?: string): Promise<GameSnapshot> {
    return this.request('/api/game', {}, GameSnapshotSchema,
      traceId ? { id: traceId, phase: 'snapshot' } : undefined);
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

  async joinWorld(
    characterId: string,
    worldInstanceId = this.options.worldInstanceId,
  ): Promise<{ sessionId: string; characterId: string }> {
    this.setWorldInstanceId(worldInstanceId);
    return this.request('/api/world-session', {
      method: 'POST',
      body: JSON.stringify({ characterId, worldInstanceId }),
    }, WorldSessionResponseSchema);
  }

  async leaveWorld(): Promise<void> {
    const response = await this.fetcher(`${this.options.basePath?.replace(/\/$/, '') ?? ''}/api/world-session`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-mudd-world-instance': this.options.worldInstanceId,
      },
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : undefined;
      throw new MuddHttpError(message ?? `Request failed (${response.status}).`, response.status);
    }
  }

  async createCharacter(name: string, commandId = crypto.randomUUID(), classId?: string): Promise<CommandResponse> {
    const command = CreateCharacterCommandSchema.parse({
      type: 'character.create',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      payload: { name, ...(classId ? { classId } : {}) },
    });
    return this.send(command);
  }

  async chooseCharacterClass(characterId: string, expectedVersion: number, classId: string, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    return this.send(ChooseCharacterClassCommandSchema.parse({
      type: 'character.class.choose', version: 1, commandId,
      worldInstanceId: this.options.worldInstanceId, characterId, expectedVersion, payload: { classId },
    }));
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

  async look(
    characterId: string,
    queryId = crypto.randomUUID(),
    options: Readonly<{ includeNpcDescriptions?: boolean }> = {},
  ): Promise<LocationProjection> {
    const query = LocationDescribeQuerySchema.parse({
      type: 'location.describe',
      version: 1,
      queryId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: options.includeNpcDescriptions ? { includeNpcDescriptions: true } : {},
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

  async dailyBoard(characterId: string, boardId: string) {
    const query = DailyBoardQuerySchema.parse({
      type: 'daily.board', version: 1, queryId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId, characterId, payload: { boardId },
    });
    const result = await this.request('/api/queries', { method: 'POST', body: JSON.stringify(query) },
      queryResultSchema(DailyBoardProjectionSchema));
    if (!result.ok) throw new Error(result.message);
    return result.value;
  }

  async dailyJob(characterId: string, expectedVersion: number, payload: {
    boardId: string; cycle: string; jobId: string; action: 'accept' | 'deliver';
  }, commandId = crypto.randomUUID()) {
    return this.send(DailyJobCommandSchema.parse({
      type: 'daily.job', version: 1, commandId, worldInstanceId: this.options.worldInstanceId,
      characterId, expectedVersion, payload,
    }));
  }

  async gatherSupply(characterId: string, expectedVersion: number, sourceId: string, cycle: string, commandId = crypto.randomUUID()) {
    return this.send(GatherSupplyCommandSchema.parse({
      type: 'supply.gather', version: 1, commandId, worldInstanceId: this.options.worldInstanceId,
      characterId, expectedVersion, payload: { sourceId, cycle },
    }));
  }

  async startFishingCast(characterId: string, rodItemId: string, expectedVersion: number, commandId = crypto.randomUUID()) {
    return this.send(FishingCastCommandSchema.parse({
      type: 'fishing.cast', version: 1, commandId, worldInstanceId: this.options.worldInstanceId,
      characterId, expectedVersion, payload: { rodItemId },
    }));
  }

  async advanceFishingCast(characterId: string, castId: string, expectedVersion: number, commandId = crypto.randomUUID()) {
    return this.send(FishingAdvanceCommandSchema.parse({
      type: 'fishing.advance', version: 1, commandId, worldInstanceId: this.options.worldInstanceId,
      characterId, expectedVersion, payload: { castId },
    }));
  }

  async startWoodcutting(characterId: string, axeItemId: string, treeId: string, expectedVersion: number, commandId = crypto.randomUUID()) {
    return this.send(StartWoodcuttingCommandSchema.parse({
      type: 'woodcutting.start', version: 1, commandId, worldInstanceId: this.options.worldInstanceId,
      characterId, expectedVersion, payload: { axeItemId, treeId },
    }));
  }

  async advanceWoodcutting(characterId: string, actionId: string, expectedVersion: number, commandId = crypto.randomUUID()) {
    return this.send(AdvanceWoodcuttingCommandSchema.parse({
      type: 'woodcutting.advance', version: 1, commandId, worldInstanceId: this.options.worldInstanceId,
      characterId, expectedVersion, payload: { actionId },
    }));
  }

  async getCraftingCatalog(characterId: string, queryId = crypto.randomUUID()) {
    const query = CraftingCatalogQuerySchema.parse({
      type: 'crafting.catalog',
      version: 1,
      queryId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: {},
    });
    const result = await this.request('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    }, queryResultSchema(CraftingCatalogProjectionSchema));
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to list craftable items.');
    return result.value;
  }

  async craft(
    characterId: string,
    expectedVersion: number,
    recipeId: string,
    quantity: 1 | 5 | 10,
    commandId = crypto.randomUUID(),
  ) {
    return this.send(CraftingCommandSchema.parse({
      type: 'crafting.craft',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { recipeId, quantity },
    }));
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

  async rest(characterId: string, expectedVersion: number, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    const command = CharacterRestCommandSchema.parse({
      type: 'character.rest',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: {},
    });
    return this.send(command);
  }

  async stand(characterId: string, expectedVersion: number, commandId = crypto.randomUUID()): Promise<CommandResponse> {
    const command = CharacterStandCommandSchema.parse({
      type: 'character.stand',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: {},
    });
    return this.send(command);
  }

  async performCombatAction(
    characterId: string,
    action: CombatActionId,
    expectedVersion: number,
    target: { encounterId?: string; targetNpcId?: string; itemId?: string; abilityId?: string },
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
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    return this.send(InteractionRequestCommandSchema.parse({
      type: 'interaction.request',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { kind, recipientCharacterId },
    }));
  }

  async respondToInteraction(
    characterId: string,
    requestId: string,
    response: 'accept' | 'decline',
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    return this.send(InteractionRespondCommandSchema.parse({
      type: 'interaction.respond',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { requestId, response },
    }));
  }

  async performPvpAction(
    characterId: string,
    encounterId: string,
    action: 'attack' | 'defend' | 'flee' | 'use-item' | 'ability',
    itemId?: string,
    abilityId?: string,
  ): Promise<CommandResponse> {
    return this.send(PvpCombatActionCommandSchema.parse({
      type: 'pvp.action',
      version: 1,
      commandId: crypto.randomUUID(),
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { encounterId, action, ...(itemId ? { itemId } : {}), ...(abilityId ? { abilityId } : {}) },
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
    options: { itemId?: string; targetParticipantId?: string; abilityId?: string } = {},
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

  async restartNpcDialogue(
    characterId: string,
    npcId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const command = NpcDialogueRestartCommandSchema.parse({
      type: 'npc.dialogue.restart',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { npcId },
    });
    return this.send(command);
  }

  async move(
    characterId: string,
    exitId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
    traceId?: string,
  ): Promise<CommandResponse> {
    const command = MoveCharacterCommandSchema.parse({
      type: 'character.move',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { exitId },
    });
    return this.send(command, traceId);
  }

  async roadStep(
    characterId: string,
    exitId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
    traceId?: string,
  ): Promise<CommandResponse> {
    const command = RoadStepCommandSchema.parse({
      type: 'character.road.step',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { exitId },
    });
    return this.send(command, traceId);
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

  async put(
    characterId: string,
    itemId: string,
    containerId: string,
    expectedVersion: number,
    commandId = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const command = PutCharacterItemCommandSchema.parse({
      type: 'character.put',
      version: 1,
      commandId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      expectedVersion,
      payload: { itemId, containerId },
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

  private async send(command: unknown, traceId?: string): Promise<CommandResponse> {
    const result = await this.postCommand(command, traceId);
    if (result.receipt.ok) return result;

    const commandDetails = VersionedCharacterCommandSchema.safeParse(command);
    const conflict = /^Expected revision (\d+); current revision is (\d+)\.$/.exec(result.receipt.message);
    if (
      result.receipt.code !== 'VERSION_CONFLICT' ||
      !commandDetails.success ||
      !conflict
    ) {
      throw new MuddCommandError(result.receipt.message, result.receipt.code);
    }

    const expectedVersion = Number(conflict[1]);
    const reportedCurrentVersion = Number(conflict[2]);
    let latest: GameSnapshot;
    try {
      latest = await this.getGame(traceId);
    } catch {
      throw new MuddCommandError('The world updated while you were acting. Please try again.', 'VERSION_CONFLICT');
    }
    const character = latest.character;
    if (
      !character ||
      character.characterId !== commandDetails.data.characterId ||
      character.revision < reportedCurrentVersion ||
      character.revision <= expectedVersion
    ) {
      throw new MuddCommandError('The world updated while you were acting. Please try again.', 'VERSION_CONFLICT');
    }

    const retried = await this.postCommand({
      ...(command as Record<string, unknown>),
      expectedVersion: character.revision,
    }, traceId);
    if (!retried.receipt.ok) {
      if (retried.receipt.code === 'VERSION_CONFLICT') {
        throw new MuddCommandError('The world updated while you were acting. Please try again.', 'VERSION_CONFLICT');
      }
      throw new MuddCommandError(retried.receipt.message, retried.receipt.code);
    }
    return retried;
  }

  private async postCommand(command: unknown, traceId?: string): Promise<CommandResponse> {
    const commandType = command && typeof command === 'object' && 'type' in command &&
      typeof command.type === 'string' ? command.type : undefined;
    return this.request('/api/commands', {
      method: 'POST',
      body: JSON.stringify(command),
    }, CommandResponseSchema,
    traceId ? { id: traceId, phase: 'command', commandType } : undefined);
  }

  private async request<Schema extends z.ZodTypeAny>(
    path: string,
    init: RequestInit,
    schema: Schema,
    trace?: RequestTrace,
  ): Promise<z.output<Schema>> {
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.basePath?.replace(/\/$/, '') ?? ''}${path}`, {
        ...init,
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-mudd-world-instance': this.options.worldInstanceId,
          ...(trace ? {
            'x-mudd-trace-id': trace.id,
            'x-mudd-trace-phase': trace.phase,
          } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      if (trace) {
        const completedAt = performance.now();
        console.info('[mudd_perf_trace_request]', JSON.stringify({
          traceId: trace.id,
          phase: trace.phase,
          commandType: trace.commandType,
          status: null,
          fetchToHeadersMs: Math.round((completedAt - startedAt) * 10) / 10,
          bodyReadMs: 0,
          schemaValidationMs: 0,
          totalClientMs: Math.round((completedAt - startedAt) * 10) / 10,
        }));
      }
      throw error;
    }
    const headersAt = performance.now();
    const body: unknown = await response.json().catch(() => undefined);
    const bodyReadAt = performance.now();
    const requestId = response.headers.get('x-request-id');
    if (!response.ok) {
      if (trace) {
        console.info('[mudd_perf_trace_request]', JSON.stringify({
          traceId: trace.id,
          phase: trace.phase,
          commandType: trace.commandType,
          serverRequestId: requestId,
          status: response.status,
          fetchToHeadersMs: Math.round((headersAt - startedAt) * 10) / 10,
          bodyReadMs: Math.round((bodyReadAt - headersAt) * 10) / 10,
          schemaValidationMs: 0,
          totalClientMs: Math.round((bodyReadAt - startedAt) * 10) / 10,
        }));
      }
      const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : undefined;
      throw new MuddHttpError(message ?? `Request failed (${response.status}).`, response.status);
    }
    const parsed = schema.safeParse(body);
    const completedAt = performance.now();
    if (trace) {
      console.info('[mudd_perf_trace_request]', JSON.stringify({
        traceId: trace.id,
        phase: trace.phase,
        commandType: trace.commandType,
        serverRequestId: requestId,
        status: response.status,
        fetchToHeadersMs: Math.round((headersAt - startedAt) * 10) / 10,
        bodyReadMs: Math.round((bodyReadAt - headersAt) * 10) / 10,
        schemaValidationMs: Math.round((completedAt - bodyReadAt) * 10) / 10,
        totalClientMs: Math.round((completedAt - startedAt) * 10) / 10,
      }));
    }
    if (!parsed.success) throw new Error('The server returned an invalid response.');
    return parsed.data;
  }
}
