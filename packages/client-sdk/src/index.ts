import {
  CreateCharacterCommandSchema,
  LocationDescribeQuerySchema,
  MoveCharacterCommandSchema,
  type CharacterProjection,
  type CommandReceipt,
  type LocationProjection,
} from '@mudd/contracts';

export interface GameSnapshot {
  player: { id: string; displayName: string };
  character?: CharacterProjection;
  location?: LocationProjection;
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
