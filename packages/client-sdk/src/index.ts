import {
  CharacterProjectionSchema,
  CommandReceiptSchema,
  CreateCharacterCommandSchema,
  RenameCharacterCommandSchema,
  ArchiveCharacterCommandSchema,
  RestoreCharacterCommandSchema,
  LocationDescribeQuerySchema,
  NpcDialogueChoiceCommandSchema,
  NpcTalkQuerySchema,
  ObjectInspectQuerySchema,
  MoveCharacterCommandSchema,
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
  QuestJournalSchema,
  WorldMapProjectionSchema,
  ObjectInspectionProjectionSchema,
  NpcDialogueProjectionSchema,
  MerchantCatalogProjectionSchema,
  MerchantCatalogQuerySchema,
  MerchantPurchaseCommandSchema,
  InnRestCommandSchema,
  CombatActionCommandSchema,
  type LocationProjection,
  type NpcDialogueProjection,
  type ReadableObjectProjection,
  type ObjectInspectionProjection,
  type MerchantCatalogProjection,
  type CombatActionId,
  type EquipmentSlot,
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

  async getCharacters(): Promise<CharacterRosterSnapshot> {
    return this.request('/api/characters', {}, CharacterRosterSnapshotSchema);
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
