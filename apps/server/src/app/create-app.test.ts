import { Server } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

// These imports must remain type-only throughout the reusable construction graph.
vi.mock('../db/client.js', () => { throw new Error('Construction imported the real database'); });
vi.mock('../auth/session-service.js', () => { throw new Error('Construction imported session persistence'); });
vi.mock('../worlds/world-registry.js', () => { throw new Error('Construction imported production worlds'); });
vi.mock('../realtime/realtime-notifications.js', () => { throw new Error('Construction started notifications'); });

describe('reusable application construction', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers routes without acquiring database, worker, listener, or signal resources', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen');
    const signalCounts = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));
    const { createApplication } = await import('./create-app.js');
    const unused = vi.fn(() => { throw new Error('Construction invoked a runtime dependency'); });
    const dependencies = {
      db: {}, pool: {}, store: {}, worldRuntimes: new Map(), registeredWorlds: [],
      trustedProxyHops: 0, allowedOrigins: new Set(), trustedHosts: new Set(), e2eAuthEnabled: true,
      runtimeFor: unused, getAccountIdentityForRequest: unused, createGuestIdentity: unused,
      expiredGuestCookie: '', listRoomOccupants: unused, touchWorldSessionPresence: unused,
      createPlayerRoomChatMessage: unused, getRoomChatMessageBySourceEffectId: unused,
      listRoomChatMessages: unused, MAX_ROOM_CHAT_MESSAGE_LENGTH: 500,
      worldActivity: {}, toWorldSummary: unused, runPendingEffectBatch: unused,
    } as unknown as Parameters<typeof createApplication>[0];
    const first = createApplication(dependencies, new URL('../index.ts', import.meta.url).href);
    const second = createApplication(dependencies, new URL('../index.ts', import.meta.url).href);
    expect(first.app).not.toBe(second.app);
    expect(listen).not.toHaveBeenCalled();
    expect(unused).not.toHaveBeenCalled();
    expect(['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal))).toEqual(signalCounts);
    first.realtimeGateway.close();
    second.realtimeGateway.close();
  });
});
