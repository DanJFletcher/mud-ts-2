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

  it('adds character revision hints for protocol 2 clients only', async () => {
    const view = { worldInstanceId: 'w', characterId: 'a', playerId: 'player-a', roomId: 'room-a',
      expiresAt: Date.now() + 30_000,
      values: { chat: { cursor: 1 }, presence: [], interactions: [], party: null, team: null, character: 4 } };
    const gateway = createRealtimeGateway(async () => view);
    const current = new FakeSocket();
    const legacy = new FakeSocket();
    gateway.connect(current as never, request, { protocolVersion: 2 });
    gateway.connect(legacy as never, request);
    current.message({ type: 'subscribe', version: 1, channels: ['chat', 'character'] });
    legacy.message({ type: 'subscribe', version: 1, channels: ['chat', 'character'] });
    await flush();
    expect(current.frames[2]).toMatchObject({
      type: 'invalidate', version: 2, channels: ['chat', 'character'], revisions: { character: 4 },
    });
    expect(legacy.frames[2]).toMatchObject({ type: 'invalidate', version: 1, channels: ['chat', 'character'] });
    expect(legacy.frames[2]).not.toHaveProperty('revisions');

    current.frames.length = 0; legacy.frames.length = 0;
    view.values.chat = { cursor: 2 };
    gateway.invalidate({ world: 'w', kind: 'room', roomId: 'room-a' });
    await flush();
    expect(current.frames).toEqual([expect.objectContaining({ version: 2, channels: ['chat'] })]);
    expect(current.frames[0]).not.toHaveProperty('revisions');

    current.frames.length = 0;
    view.values.character = 5;
    gateway.invalidate({ world: 'w', kind: 'character', characterId: 'a' });
    await flush();
    expect(current.frames).toEqual([expect.objectContaining({ channels: ['character'], revisions: { character: 5 } })]);
    expect(legacy.frames.at(-1)).not.toHaveProperty('revisions');
    gateway.close();
  });

  it('rereads only the channels a wakeup can change', async () => {
    const view = { worldInstanceId: 'w', characterId: 'a', playerId: 'player-a', roomId: 'room-a',
      expiresAt: Date.now() + 30_000,
      values: { chat: null, presence: null, interactions: null, party: null, team: null, character: 1 } };
    const read = vi.fn(async (_request: Request, _channels: readonly string[]) => view);
    const gateway = createRealtimeGateway(read);
    const socket = new FakeSocket();
    gateway.connect(socket as never, request);
    socket.message({ type: 'subscribe', version: 1, channels: ['chat', 'presence', 'interactions', 'party', 'team', 'character'] });
    await flush();
    expect(read.mock.calls.at(-1)?.[1]).toEqual(['chat', 'presence', 'interactions', 'party', 'team', 'character']);
    const readsFor = async (change: Parameters<typeof gateway.invalidate>[0]) => {
      read.mockClear();
      gateway.invalidate(change);
      await flush();
      return read.mock.calls.map(([, channels]) => [...channels].sort());
    };

    // NPC movement and chat in the room: presence and chat only.
    expect(await readsFor({ world: 'w', kind: 'room', roomId: 'room-a' })).toEqual([['chat', 'presence']]);
    // Another character acting in the room: presence only.
    expect(await readsFor({ world: 'w', kind: 'character', characterId: 'b', roomId: 'room-a' })).toEqual([['presence']]);
    expect(await readsFor({ world: 'w', kind: 'interaction' })).toEqual([['interactions']]);
    expect(await readsFor({ world: 'w', kind: 'party' })).toEqual([['party']]);
    expect(await readsFor({ world: 'w', kind: 'team' })).toEqual([['team']]);
    // The client's own character: everything, since it may have changed rooms.
    expect(await readsFor({ world: 'w', kind: 'character', characterId: 'a' }))
      .toEqual([['character', 'chat', 'interactions', 'party', 'presence', 'team']]);
    // Elsewhere in the world: no read at all.
    expect(await readsFor({ world: 'w', kind: 'room', roomId: 'room-b' })).toEqual([]);
    expect(await readsFor({ world: 'w', kind: 'character', characterId: 'b', roomId: 'room-b' })).toEqual([]);
    gateway.close();
  });

  it('skips wakeups for channels the client has not subscribed to', async () => {
    const view = { worldInstanceId: 'w', characterId: 'a', playerId: 'player-a', roomId: 'room-a',
      expiresAt: Date.now() + 30_000,
      values: { chat: null, presence: null, interactions: null, party: null, team: null, character: 1 } };
    const read = vi.fn(async () => view);
    const gateway = createRealtimeGateway(read);
    const socket = new FakeSocket();
    gateway.connect(socket as never, request);
    socket.message({ type: 'subscribe', version: 1, channels: ['chat'] });
    await flush();
    read.mockClear();
    gateway.invalidate({ world: 'w', kind: 'interaction' });
    gateway.invalidate({ world: 'w', kind: 'character', characterId: 'b', roomId: 'room-a' });
    await flush();
    expect(read).not.toHaveBeenCalled();
    gateway.close();
  });

  it('rereads room channels when a narrower read finds the character in a new room', async () => {
    const view = { worldInstanceId: 'w', characterId: 'a', playerId: 'player-a', roomId: 'room-a',
      expiresAt: Date.now() + 30_000,
      values: { chat: null, presence: null, interactions: null, party: { size: 1 }, team: null, character: 1 } };
    const read = vi.fn(async (_request: Request, _channels: readonly string[]) => view);
    const gateway = createRealtimeGateway(read);
    const socket = new FakeSocket();
    gateway.connect(socket as never, request);
    socket.message({ type: 'subscribe', version: 1, channels: ['chat', 'presence', 'party'] });
    await flush();
    read.mockClear();
    view.roomId = 'room-b';
    view.values.party = { size: 2 };
    gateway.invalidate({ world: 'w', kind: 'party' });
    await flush();
    expect(read.mock.calls.map(([, channels]) => [...channels].sort())).toEqual([['party'], ['chat', 'presence']]);
    gateway.close();
  });

  it('merges wakeups that arrive during a read into one follow-up read', async () => {
    const view = { worldInstanceId: 'w', characterId: 'a', playerId: 'player-a', roomId: 'room-a',
      expiresAt: Date.now() + 30_000,
      values: { chat: null, presence: null, interactions: null, party: null, team: null, character: 1 } };
    let release: (() => void) | undefined;
    const read = vi.fn(async (_request: Request, _channels: readonly string[]) => view);
    const gateway = createRealtimeGateway(read);
    const socket = new FakeSocket();
    gateway.connect(socket as never, request);
    socket.message({ type: 'subscribe', version: 1, channels: ['chat', 'presence', 'interactions', 'party'] });
    await flush();
    read.mockClear();
    read.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return view;
    });
    gateway.invalidate({ world: 'w', kind: 'party' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    gateway.invalidate({ world: 'w', kind: 'interaction' });
    gateway.invalidate({ world: 'w', kind: 'room', roomId: 'room-a' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    release?.();
    await flush();
    expect(read.mock.calls.map(([, channels]) => [...channels].sort()))
      .toEqual([['party'], ['chat', 'interactions', 'presence']]);
    gateway.close();
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
