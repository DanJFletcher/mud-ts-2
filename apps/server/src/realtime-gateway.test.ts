import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { createRealtimeGateway } from './realtime-gateway.js';

class FakeSocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; frames: unknown[] = [];
  send(frame: string) { this.frames.push(JSON.parse(frame)); }
  close() { this.readyState = 3; this.emit('close'); }
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
    gateway.invalidate({ world: 'other-world', kind: 'room', roomId: 'room-a' });
    await flush();
    expect(socket.frames).toHaveLength(0);
    view.values.chat = { cursor: 2 };
    gateway.invalidate({ world: 'w', kind: 'room', roomId: 'room-a' });
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
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
    second.message({ type: 'subscribe', version: 1, channels: ['chat', 'presence'] });
    await flush();
    expect(second.readyState).toBe(1);
    second.message({ type: 'subscribe', version: 1, channels: ['presence'] });
    expect(second.readyState).toBe(3);
    gateway.close(); admittedGateway.close();
  });
});
