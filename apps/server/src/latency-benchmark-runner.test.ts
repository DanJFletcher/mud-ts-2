import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  append: vi.fn(),
  dbSelect: vi.fn(),
  dispatch: vi.fn(),
  query: vi.fn(),
  replay: vi.fn(),
  poolEnd: vi.fn(),
  startRuntimes: vi.fn(),
  stopRuntimes: vi.fn(),
  tick: vi.fn(),
  streamRevision: 1,
  streamEvents: [] as unknown[],
  world: {
    roads: [{ encounterChancePercent: 15 }],
    locations: [{
      npcs: [{
        id: 'mossgate-training-sentinel',
        combatProfile: { attackDamage: 4, maxHealth: 10 },
      }],
    }],
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...values: unknown[]) => values),
  eq: vi.fn((...values: unknown[]) => values),
  inArray: vi.fn((...values: unknown[]) => values),
}));

vi.mock('@mudd/engine-core', () => ({ replayCharacter: state.replay }));
vi.mock('@mudd/world-demo', () => ({ DEMO_WORLD_INSTANCE_ID: 'demo-instance' }));
vi.mock('./db/schema.js', () => ({
  players: { id: 'players.id' },
  gameEvents: {
    worldInstanceId: 'gameEvents.worldInstanceId',
    streamId: 'gameEvents.streamId',
    streamVersion: 'gameEvents.streamVersion',
  },
  commandReceipts: { streamId: 'commandReceipts.streamId' },
  characters: { id: 'characters.id' },
  durableEffects: { sourceStreamId: 'durableEffects.sourceStreamId' },
}));
vi.mock('./db/client.js', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    select: state.dbSelect,
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  },
  pool: { end: state.poolEnd },
}));
vi.mock('./persistence/postgres-event-store.js', () => ({
  PostgresEventStore: class {
    append(...args: unknown[]) {
      return state.append(...args);
    }

    readStream() {
      return Promise.resolve(state.streamEvents);
    }

    readStreamRevision() {
      return Promise.resolve(state.streamRevision);
    }
  },
  toStoredGameEvent: (event: unknown) => event,
}));
vi.mock('./world-registry.js', () => ({
  registeredWorlds: [{ worldInstanceId: 'demo-instance', world: state.world }],
  createWorldRuntimes: vi.fn((
    _store: unknown,
    authorization: {
      canAccessInstance: (worldId: string) => Promise<boolean>;
      ownsCharacter: (playerId: string, characterId: string) => Promise<boolean>;
    },
  ) => {
    void authorization.canAccessInstance('demo-instance');
    void authorization.ownsCharacter('fixture-player', 'fixture-character');
    return new Map([
      ['demo-instance', { engine: { dispatch: state.dispatch, query: state.query } }],
    ]);
  }),
  startWorldRuntimes: state.startRuntimes,
  stopWorldRuntimes: state.stopRuntimes,
}));
vi.mock('./performance.js', () => ({
  newMeasurements: () => ({ queries: 0, queryMs: 0, poolWaitMs: 0 }),
  requestMeasurements: {
    run: async (_metrics: unknown, callback: () => Promise<unknown>) => callback(),
  },
}));
vi.mock('./stamina-recovery-scheduler.js', () => ({
  createStaminaRecoveryScheduler: vi.fn((options: {
    now: () => Date;
    listSessions: () => Promise<unknown>;
  }) => ({
    tick: async () => {
      options.now();
      await options.listSessions();
      await state.tick();
    },
  })),
}));

const localDatabaseUrl = 'postgresql://runner@127.0.0.1:55439/mudd_latency_test';

describe('latency benchmark runner with isolated dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.streamRevision = 1;
    state.streamEvents = [{ type: 'character.created', payload: { name: 'Fixture' } }];
    state.world.roads = [{ encounterChancePercent: 15 }];
    state.world.locations[0]!.npcs[0]!.combatProfile = { attackDamage: 4, maxHealth: 10 };
    state.dbSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => state.streamEvents,
        }),
      }),
    }));
    state.append.mockResolvedValue({ kind: 'committed' });
    state.dispatch.mockResolvedValue({ receipt: { ok: true } });
    state.query.mockResolvedValue({ ok: true, value: {} });
    state.replay.mockReturnValue({
      revision: 2,
      combat: { encounterId: 'fixture-encounter' },
    });
    state.startRuntimes.mockResolvedValue(undefined);
    state.stopRuntimes.mockResolvedValue(undefined);
    state.tick.mockResolvedValue(undefined);
    state.poolEnd.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('runs both history policies and action types without connecting to a database', async () => {
    vi.stubEnv('DATABASE_URL', localDatabaseUrl);
    vi.stubEnv('MUDD_BENCHMARK_LOCAL', '1');
    vi.resetModules();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await import('./latency-benchmark.js');

    expect(state.append).toHaveBeenCalledTimes(8);
    expect(state.dispatch).toHaveBeenCalledTimes(240);
    expect(state.query).toHaveBeenCalledTimes(364);
    expect(state.startRuntimes).toHaveBeenCalledTimes(4);
    expect(state.stopRuntimes).toHaveBeenCalledTimes(4);
    expect(state.tick).toHaveBeenCalledTimes(180);
    expect(state.poolEnd).toHaveBeenCalledTimes(1);
    expect(state.world.roads[0]?.encounterChancePercent).toBe(0);
    expect(state.world.locations[0]?.npcs[0]?.combatProfile).toMatchObject({
      attackDamage: 0,
      maxHealth: 1000,
    });
    expect(log).toHaveBeenCalledTimes(20);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
      mode: 'before',
      history: 100,
      action: 'look',
    });
    log.mockRestore();
  });

  it('deletes oversized cached histories instead of retaining them', async () => {
    vi.stubEnv('DATABASE_URL', localDatabaseUrl);
    vi.stubEnv('MUDD_BENCHMARK_LOCAL', '1');
    state.streamEvents = [{ payload: 'x'.repeat(512 * 1024 + 1) }];
    vi.resetModules();

    await import('./latency-benchmark.js');

    expect(state.dbSelect).toHaveBeenCalled();
    expect(state.poolEnd).toHaveBeenCalledTimes(1);
  });

  it('fails and cleans up when a location snapshot query is rejected', async () => {
    vi.stubEnv('DATABASE_URL', localDatabaseUrl);
    vi.stubEnv('MUDD_BENCHMARK_LOCAL', '1');
    state.query.mockResolvedValueOnce({ ok: false, message: 'snapshot query failed' });
    vi.resetModules();

    await expect(import('./latency-benchmark.js'))
      .rejects.toThrow('snapshot query failed');

    expect(state.poolEnd).toHaveBeenCalledTimes(1);
  });

  it('fails when a benchmark action is rejected by the engine', async () => {
    vi.stubEnv('DATABASE_URL', localDatabaseUrl);
    vi.stubEnv('MUDD_BENCHMARK_LOCAL', '1');
    state.dispatch.mockResolvedValueOnce({
      receipt: { ok: false, message: 'movement rejected' },
    });
    vi.resetModules();

    await expect(import('./latency-benchmark.js'))
      .rejects.toThrow('move: movement rejected');

    expect(state.poolEnd).toHaveBeenCalledTimes(1);
  });

  it('cleans up even when benchmark fixture creation fails', async () => {
    vi.stubEnv('DATABASE_URL', localDatabaseUrl);
    vi.stubEnv('MUDD_BENCHMARK_LOCAL', '1');
    state.append.mockResolvedValueOnce({ kind: 'conflict' });
    vi.resetModules();

    await expect(import('./latency-benchmark.js'))
      .rejects.toThrow('Could not create benchmark fixture.');

    expect(state.poolEnd).toHaveBeenCalledTimes(1);
  });
});
