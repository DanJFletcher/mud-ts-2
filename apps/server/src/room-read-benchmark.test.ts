import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';

const state = vi.hoisted(() => ({
  appendCount: 0,
  poolEnd: vi.fn(),
  listChat: vi.fn(),
  listPresence: vi.fn(),
}));

vi.mock('./db/client.js', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  },
  pool: { end: state.poolEnd },
}));

vi.mock('./persistence/postgres-event-store.js', () => ({
  PostgresEventStore: class {
    append() {
      state.appendCount += 1;
      return Promise.resolve({ kind: 'committed' });
    }
  },
}));

vi.mock('./room-chat-service.js', () => ({ listRoomChatMessages: state.listChat }));
vi.mock('./room-presence-service.js', () => ({ listRoomOccupants: state.listPresence }));

import {
  assertRoomReadBenchmarkEnvironment,
  runRoomReadBenchmarkCli,
  runRoomReadBenchmark,
} from './room-read-benchmark.js';

const localBenchmarkEnv = {
  MUDD_BENCHMARK_LOCAL: '1',
  DATABASE_URL: 'postgresql://runner@localhost:55439/mudd_room_test',
};

describe('room read benchmark safeguards and runner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    state.appendCount = 0;
    state.listChat.mockResolvedValue([]);
    state.listPresence.mockResolvedValue([]);
  });

  it('requires explicit opt-in and a localhost test database', () => {
    expect(() => assertRoomReadBenchmarkEnvironment({
      ...localBenchmarkEnv,
      MUDD_BENCHMARK_LOCAL: '0',
    })).toThrow('Benchmark requires explicitly opted-in local test database.');
    expect(() => assertRoomReadBenchmarkEnvironment({
      ...localBenchmarkEnv,
      DATABASE_URL: 'postgresql://runner@prod.example.com/mudd_room_test',
    })).toThrow('Benchmark requires explicitly opted-in local test database.');
    expect(() => assertRoomReadBenchmarkEnvironment({
      ...localBenchmarkEnv,
      DATABASE_URL: 'postgresql://runner@localhost/mudd_development',
    })).toThrow('Benchmark requires explicitly opted-in local test database.');
    expect(() => assertRoomReadBenchmarkEnvironment(localBenchmarkEnv)).not.toThrow();
  });

  it('creates only local fixtures, measures chat and presence, and cleans up', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const sourcePath = fileURLToPath(new URL('./room-read-benchmark.ts', import.meta.url));

    await runRoomReadBenchmarkCli(
      sourcePath,
      pathToFileURL(sourcePath).href,
      localBenchmarkEnv,
    );

    expect(state.appendCount).toBe(100);
    expect(state.listChat).toHaveBeenCalledTimes(90);
    expect(state.listPresence).toHaveBeenCalledTimes(90);
    expect(log).toHaveBeenCalledTimes(6);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
      action: 'chat',
      population: 2,
      history: 2000,
      samples: 30,
    });
    expect(JSON.parse(log.mock.calls[1]?.[0] as string)).toMatchObject({
      action: 'presence',
      population: 2,
      history: 2000,
      samples: 30,
    });
    expect(state.poolEnd).toHaveBeenCalledTimes(1);
  });

  it('cleans up local fixtures and closes the pool when a measurement fails', async () => {
    state.listChat.mockRejectedValueOnce(new Error('chat read failed'));

    await expect(runRoomReadBenchmark(localBenchmarkEnv)).rejects.toThrow('chat read failed');

    expect(state.appendCount).toBe(2);
    expect(state.poolEnd).toHaveBeenCalledTimes(1);
  });

  it('refuses to run the benchmark against a remote database', async () => {
    await expect(runRoomReadBenchmark({
      ...localBenchmarkEnv,
      DATABASE_URL: 'postgresql://runner@prod.example.com/mudd_room_test',
    })).rejects.toThrow('Benchmark requires explicitly opted-in local test database.');

    expect(state.appendCount).toBe(0);
    expect(state.poolEnd).not.toHaveBeenCalled();
  });
});
