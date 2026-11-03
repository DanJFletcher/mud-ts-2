import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  order: [] as string[],
  failAt: '',
  e2eAuthEnabled: true,
  close: vi.fn(),
  listen: vi.fn(),
  stopNotifications: vi.fn(),
  closeGateway: vi.fn(),
  stopSchedulers: vi.fn(),
  stopEffects: vi.fn(),
  endPool: vi.fn(),
  stopWorlds: vi.fn(),
}));
function stage(name: string) {
  fixture.order.push(name);
  if (fixture.failAt === name) throw new Error(name);
}
vi.mock('./server-config.js', () => ({
  readServerConfiguration: () => {
    stage('configuration');
    return { trustedProxyHops: 0, allowedOrigins: new Set(), trustedHosts: new Set() };
  },
}));
vi.mock('../auth/e2e-auth-mode.js', () => ({ readE2eAuthMode: () => fixture.e2eAuthEnabled }));
vi.mock('../db/client.js', () => ({
  db: {}, pool: { end: fixture.endPool }, warmDatabasePool: async () => stage('warmup'),
}));
vi.mock('../persistence/postgres-event-store.js', () => ({
  PostgresEventStore: class { async rebuildRoomStates() { stage('rebuild'); } },
}));
vi.mock('../worlds/world-registry.js', () => ({
  registeredWorlds: [], toWorldSummary: vi.fn(),
  createWorldRuntimes: () => { stage('world construction'); return new Map(); },
  startWorldRuntimes: async () => stage('world startup'), stopWorldRuntimes: fixture.stopWorlds,
}));
vi.mock('../auth/session-service.js', () => ({
  createGuestIdentity: vi.fn(), expiredGuestCookie: '', getAccountIdentityForRequest: vi.fn(),
}));
vi.mock('../jobs/runtime-schedulers.js', () => ({
  startRuntimeSchedulers: async () => { stage('schedulers'); return { stop: fixture.stopSchedulers }; },
}));
vi.mock('../jobs/effect-processing.js', () => ({
  startEffectProcessing: () => {
    stage('effects');
    return { stop: fixture.stopEffects, runPendingEffectBatch: vi.fn(), wakeEffectBatch: vi.fn() };
  },
}));
vi.mock('../jobs/interaction-maintenance.js', () => ({ startInteractionMaintenance: () => stage('interactions') }));
vi.mock('../realtime/realtime-notifications.js', () => ({
  startRealtimeNotifications: () => { stage('notifications'); return fixture.stopNotifications; },
}));
vi.mock('./create-app.js', () => ({
  createApplication: () => {
    stage('application');
    return {
      app: { listen: fixture.listen },
      realtimeGateway: { close: fixture.closeGateway },
    };
  },
}));

import { startServer } from './bootstrap.js';

describe('production runtime composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.order.length = 0;
    fixture.failAt = '';
    fixture.e2eAuthEnabled = true;
    fixture.listen.mockImplementation(() => { stage('listen'); return { close: fixture.close }; });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('orders readiness before one set of workers, notifications and listening', async () => {
    const runtime = await startServer('file:///workspace/apps/server/dist/index.js');
    expect(fixture.order).toEqual([
      'configuration', 'warmup', 'rebuild', 'world construction', 'world startup',
      'schedulers', 'effects', 'interactions', 'application', 'notifications', 'listen',
    ]);
    expect(fixture.listen).toHaveBeenCalledOnce();
    expect(fixture.listen.mock.calls[0]?.[1]).toBe('127.0.0.1');
    await runtime.shutdown();
    for (const cleanup of [fixture.close, fixture.stopNotifications, fixture.closeGateway,
      fixture.stopSchedulers, fixture.stopEffects, fixture.endPool, fixture.stopWorlds]) {
      expect(cleanup).toHaveBeenCalledOnce();
    }
  });

  it.each(['configuration', 'warmup', 'rebuild', 'world startup'])('does not listen after failed %s readiness', async (failure) => {
    fixture.failAt = failure;
    await expect(startServer('file:///workspace/apps/server/dist/index.js')).rejects.toThrow(failure);
    expect(fixture.listen).not.toHaveBeenCalled();
    expect(fixture.order).not.toContain('notifications');
  });

  it.each([
    { port: '6100', apiPort: '6101', mode: 'test', expected: 6100 },
    { port: undefined, apiPort: '6101', mode: 'test', expected: 6101 },
    { port: undefined, apiPort: undefined, mode: 'test', expected: 5001 },
    { port: undefined, apiPort: undefined, mode: 'production', expected: 5000 },
  ])('preserves port precedence and defaults: $expected', async ({ port, apiPort, mode, expected }) => {
    vi.stubEnv('PORT', port);
    vi.stubEnv('API_PORT', apiPort);
    vi.stubEnv('NODE_ENV', mode);
    const runtime = await startServer('file:///workspace/apps/server/dist/index.js');
    expect(fixture.listen.mock.calls[0]?.[0]).toBe(expected);
    await runtime.shutdown();
  });

  it('binds normal authenticated mode to the public interface', async () => {
    fixture.e2eAuthEnabled = false;
    const runtime = await startServer('file:///workspace/apps/server/dist/index.js');
    expect(fixture.listen.mock.calls[0]?.[1]).toBe('0.0.0.0');
    await runtime.shutdown();
  });
});
