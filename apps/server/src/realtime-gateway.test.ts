import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { createRealtimeGateway } from './realtime-gateway.js';

class FakeSocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; frames: unknown[] = []; closeCode?: number;
  send(frame: string) { this.frames.push(JSON.parse(frame)); }
  close(code?: number) { this.closeCode = code; this.readyState = 3; this.emit('close'); }
  message(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
const request = {} as Request;
const flush = async () => new Promise((resolve) => setTimeout(resolve, 200));

describe('realtime gateway authorization and recovery', () => {
  it('authorizes before ready, publishes only changed channel names, and forces HTTP resync', async () => {
    const view = { worldInstanceId: 'w', characterId: 'a', playerId: 'player-a', roomId: 'room-a',
      expiresAt: Date.now() + 30_000,
      values: { chat: { cursor: 1 }, presence: ['a'], interactions: [], party: null, team: null, character: 4 } };
    const read = vi.fn(async () => view);
    const gateway = createRealtimeGateway(read);
    const socket = new FakeSocket();
    gateway.connect(socket as never, request);
    socket.message({ type: 'subscribe', version: 1, channels: ['chat', 'presence'] });
    await flush();
    expect(socket.frames[0]).toMatchObject({ type: 'ready' });
    expect(socket.frames[1]).toEqual({ type: 'resync_required', version: 1 });
    expect(socket.frames[2]).toMatchObject({ type: 'invalidate', channels: ['chat', 'presence'] });
    socket.frames.length = 0;
    gateway.refreshAll();
    await flush();
    gateway.invalidate({ world: 'other-world', kind: 'room', roomId: 'room-a' });
    await flush();
    expect(socket.frames).toHaveLength(0);
    view.values.chat = { cursor: 2 };
    gateway.invalidate({ world: 'w', kind: 'room', roomId: 'room-a' });
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
    expect(socket.frames).toHaveLength(1);
    expect(socket.frames[0]).toMatchObject({ type: 'invalidate', channels: ['chat'] });
    expect(JSON.stringify(socket.frames)).not.toContain('"cursor"');
    gateway.close();
  });

  it('closes on malformed, repeated, oversized and unauthorized subscription traffic', async () => {
    const socket = new FakeSocket();
    const gateway = createRealtimeGateway(async () => undefined);
    gateway.connect(socket as never, request);
    socket.message({ type: 'subscribe', version: 1, channels: ['chat'] });
    await flush();
    expect(socket.readyState).toBe(3);
    const second = new FakeSocket();
    const admittedGateway = createRealtimeGateway(async () => ({
      worldInstanceId: 'w', characterId: 'a', playerId: 'p', roomId: 'r',
      expiresAt: Date.now() + 30_000,
      values: { chat: null, presence: null, interactions: null, party: null, team: null, character: null },
    }));
    admittedGateway.connect(second as never, request);
    second.message({ type: 'subscribe', version: 1, channels: ['chat'] });
    second.message({ type: 'subscribe', version: 1, channels: ['chat'] });
    second.message({ type: 'subscribe', version: 1, channels: ['chat', 'presence'] });
    await flush();
    expect(second.readyState).toBe(1);
    second.message({ type: 'subscribe', version: 1, channels: ['presence'] });
    expect(second.readyState).toBe(3);
    gateway.close(); admittedGateway.close();
  });

  it('closes after authorization failures, malformed frames, or buffer pressure', async () => {
    const failingReadSocket = new FakeSocket();
    const failingReadGateway = createRealtimeGateway(async () => {
      throw new Error('View authorization failed.');
    });
    failingReadGateway.connect(failingReadSocket as never, request);
    failingReadSocket.message({ type: 'subscribe', version: 1, channels: ['chat'] });
    await flush();
    expect(failingReadSocket.readyState).toBe(3);
    failingReadGateway.close();

    const malformedSocket = new FakeSocket();
    const malformedGateway = createRealtimeGateway(async () => undefined);
    malformedGateway.connect(malformedSocket as never, request);
    malformedSocket.emit('message', Buffer.from('not JSON'));
    expect(malformedSocket.readyState).toBe(3);
    malformedGateway.close();

    const pressuredSocket = new FakeSocket();
    pressuredSocket.bufferedAmount = 64 * 1024 + 1;
    const pressuredGateway = createRealtimeGateway(async () => ({
      worldInstanceId: 'w', characterId: 'a', playerId: 'p', roomId: 'r',
      expiresAt: Date.now() + 30_000,
      values: { chat: null, presence: null, interactions: null, party: null, team: null, character: null },
    }));
    pressuredGateway.connect(pressuredSocket as never, request);
    pressuredSocket.message({ type: 'subscribe', version: 1, channels: ['chat'] });
    await flush();
    expect(pressuredSocket.readyState).toBe(3);
    pressuredGateway.close();
  });

  it('closes a player connection after membership changes and caps concurrent clients', async () => {
    const membershipSocket = new FakeSocket();
    const gateway = createRealtimeGateway(async () => ({
      worldInstanceId: 'w', characterId: 'a', playerId: 'player-a', roomId: 'r',
      expiresAt: Date.now() + 30_000,
      values: { chat: null, presence: null, interactions: null, party: null, team: null, character: null },
    }));
    gateway.connect(membershipSocket as never, request);
    membershipSocket.message({ type: 'subscribe', version: 1, channels: ['chat'] });
    await flush();
    gateway.invalidate({ world: 'w', kind: 'membership', playerId: 'player-a' });
    expect(membershipSocket.readyState).toBe(3);
    gateway.close();

    const capacityGateway = createRealtimeGateway(async () => undefined);
    for (let index = 0; index < 500; index += 1) {
      capacityGateway.connect(new FakeSocket() as never, request);
    }
    const rejectedSocket = new FakeSocket();
    capacityGateway.connect(rejectedSocket as never, request);
    expect(rejectedSocket.readyState).toBe(3);
    expect(rejectedSocket.closeCode).toBe(1013);
    capacityGateway.close();
  });
});
