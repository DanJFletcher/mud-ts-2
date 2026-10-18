import {
  CreateCharacterCommandSchema,
  RenameCharacterCommandSchema,
  ArchiveCharacterCommandSchema,
  RestoreCharacterCommandSchema,
  LocationDescribeQuerySchema,
  NpcDialogueChoiceCommandSchema,
  NpcTalkQuerySchema,
  ObjectReadQuerySchema,
  ObjectInspectQuerySchema,
  MoveCharacterCommandSchema,
  TakeCharacterItemCommandSchema,
  DropCharacterItemCommandSchema,
  type CharacterProjection,
  type CommandReceipt,
  type LocationProjection,
  type NpcDialogueProjection,
  type ReadableObjectProjection,
  type ObjectInspectionProjection,
} from '@mudd/contracts';

export interface GameSnapshot {
  player: { id: string; displayName: string };
  character?: CharacterProjection;
  location?: LocationProjection;
}

export interface CharacterRosterSnapshot {
  player: { id: string; displayName: string };
  characters: Array<CharacterProjection & { locationTitle: string }>;
  activeWorldSession: { id: string; characterId: string } | null;
}

export interface CommandResponse {
  receipt: CommandReceipt;
  streamId?: string;
}

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
    return this.request<GameSnapshot>('/api/game');
  }

  async getCharacters(): Promise<CharacterRosterSnapshot> {
    return this.request<CharacterRosterSnapshot>('/api/characters');
  }

  async joinWorld(characterId: string): Promise<{ sessionId: string; characterId: string }> {
    return this.request('/api/world-session', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    });
  }

  async leaveWorld(): Promise<void> {
    const response = await this.fetcher('/api/world-session', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const body = await response.json() as { message?: string };
      throw new Error(body.message ?? `Request failed (${response.status}).`);
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
    const result = await this.request<{ ok: boolean; value?: LocationProjection; message?: string }>('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    });
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to inspect the current location.');
    return result.value;
  }

  async read(characterId: string, objectId: string, queryId = crypto.randomUUID()): Promise<ReadableObjectProjection> {
    const query = ObjectReadQuerySchema.parse({
      type: 'object.read',
      version: 1,
      queryId,
      worldInstanceId: this.options.worldInstanceId,
      characterId,
      payload: { objectId },
    });
    const result = await this.request<{ ok: boolean; value?: ReadableObjectProjection; message?: string }>('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    });
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to read that object.');
    return result.value;
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
    const result = await this.request<{ ok: boolean; value?: ObjectInspectionProjection; message?: string }>('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    });
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
    const result = await this.request<{
      ok: boolean;
      value?: NpcDialogueProjection;
      message?: string;
    }>('/api/queries', {
      method: 'POST',
      body: JSON.stringify(query),
    });
    if (!result.ok || !result.value) throw new Error(result.message ?? 'Unable to speak to that person.');
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

  private async send(command: unknown): Promise<CommandResponse> {
    const result = await this.request<CommandResponse>('/api/commands', {
      method: 'POST',
      body: JSON.stringify(command),
    });
    if (!result.receipt.ok) throw new Error(result.receipt.message);
    return result;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    const body = await response.json() as T & { message?: string };
    if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status}).`);
    return body;
  }
}
