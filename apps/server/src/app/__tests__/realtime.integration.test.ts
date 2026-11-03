import { describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { useServerHarness, state, instanceId } from './server-harness.js';
import WebSocket from 'ws';

describe('realtime through the server', () => {
  const harness = useServerHarness();
  const { enterWorld } = harness;
  it('rejects unsafe real-time origins and closes subscriptions for unavailable worlds', async () => {
    const websocketUrl = `${harness.baseUrl.replace(/^http/, 'ws')}/api/realtime`;
    const closeCode = (socket: WebSocket, subscribe = false) => new Promise<number>((resolve, reject) => {
      socket.once('close', (code) => resolve(code));
      socket.once('error', reject);
      if (subscribe) {
        socket.once('open', () => socket.send(JSON.stringify({
          type: 'subscribe',
          version: 1,
          channels: ['chat'],
        })));
      }
    });

    expect(await closeCode(new WebSocket(websocketUrl, { headers: {} }))).toBe(1008);
    expect(await closeCode(new WebSocket(websocketUrl, {
      headers: { Origin: 'https://untrusted.example' },
    }))).toBe(1008);

    const guestSession = await fetch(`${harness.baseUrl}/api/guest-session`, { method: 'POST' });
    const cookie = guestSession.headers.get('set-cookie')?.split(';', 1)[0];
    expect(cookie).toBeTruthy();
    const unauthorizedWorldSocket = new WebSocket(`${websocketUrl}?world=not-registered`, {
      headers: { Origin: harness.baseUrl, Cookie: cookie! },
    });
    expect(await closeCode(unauthorizedWorldSocket, true)).toBe(1005);

    await enterWorld('alice', 'character-alice');
    const liveSocket = new WebSocket(`${websocketUrl}?world=${encodeURIComponent(instanceId)}`, {
      headers: { Origin: harness.baseUrl, 'x-test-user': 'alice' },
    });
    const frames: Array<{ type?: string; }> = [];
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Realtime subscription did not resync.')), 3_000);
        liveSocket.on('message', (data) => {
          const frame = JSON.parse(data.toString()) as { type?: string; };
          frames.push(frame);
          if (frame.type === 'resync_required') {
            clearTimeout(timeout);
            resolve();
          }
        });
        liveSocket.once('error', reject);
        liveSocket.once('open', () => liveSocket.send(JSON.stringify({
          type: 'subscribe',
          version: 1,
          channels: ['chat', 'presence', 'interactions', 'party', 'team', 'character'],
        })));
      });
      expect(frames.map(({ type }) => type)).toContain('ready');
      expect(frames.map(({ type }) => type)).toContain('resync_required');

      const notifications = state.realtimeNotificationCallbacks;
      if (!notifications) throw new Error('Realtime notification callbacks were not registered.');
      notifications.invalidate({ world: instanceId, kind: 'room', roomId: 'npc-room' });
      notifications.refresh();
    } finally {
      if (liveSocket.readyState !== WebSocket.CLOSED) {
        const closed = once(liveSocket, 'close');
        liveSocket.close();
        await closed;
      }
    }
  });

  it('reuses active world sessions when realtime clients reconnect', async () => {
    vi.stubEnv('MUDD_IDENTITY_CACHE', '1');
    const sockets: WebSocket[] = [];
    const subscribe = async () => {
      const socket = new WebSocket(
        `${harness.baseUrl.replace(/^http/, 'ws')}/api/realtime?world=${encodeURIComponent(instanceId)}`,
        { headers: { Origin: harness.baseUrl, 'x-test-user': 'alice' } },
      );
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Realtime session was not authorized.')), 3_000);
        socket.on('message', (data) => {
          const frame = JSON.parse(data.toString()) as { type?: string; };
          if (frame.type === 'ready') {
            clearTimeout(timeout);
            resolve();
          }
        });
        socket.once('error', reject);
        socket.once('open', () => socket.send(JSON.stringify({
          type: 'subscribe',
          version: 1,
          channels: ['character'],
        })));
      });
    };

    try {
      await enterWorld('alice', 'character-alice');
      const readsBeforeConnections = state.worldSessionSelectCount;

      await subscribe();
      const readsAfterFirstConnection = state.worldSessionSelectCount;
      expect(readsAfterFirstConnection).toBeGreaterThan(readsBeforeConnections);

      const firstClosed = once(sockets[0]!, 'close');
      sockets[0]!.close();
      await firstClosed;

      await subscribe();
      expect(state.worldSessionSelectCount).toBe(readsAfterFirstConnection);
    } finally {
      for (const socket of sockets) {
        if (socket.readyState !== WebSocket.CLOSED) {
          const closed = once(socket, 'close');
          socket.close();
          await closed;
        }
      }
      vi.unstubAllEnvs();
    }
  });
});
