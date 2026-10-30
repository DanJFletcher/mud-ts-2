import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuddRealtimeTransport } from './realtime.js';

class MockSocket {
  static instances: MockSocket[] = [];
  readyState = 0; bufferedAmount = 0;
  onopen?: () => void; onmessage?: (event: { data: string }) => void;
  onclose?: () => void; onerror?: () => void;
  sent: string[] = [];
  constructor(readonly url: string) { MockSocket.instances.push(this); }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  frame(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); MockSocket.instances = []; });

describe('MuddRealtimeTransport', () => {
  it('shares one socket, validates scope/sequence, and falls back to HTTP when disconnected', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockSocket);
    const world = 'world-a', refreshChat = vi.fn(), refreshPresence = vi.fn();
    const transport = new MuddRealtimeTransport(() => 'wss://game.test/api/realtime', () => world);
    const stopChat = transport.watch('chat', refreshChat, 3000);
    transport.watch('presence', refreshPresence, 3000);
    expect(MockSocket.instances).toHaveLength(1);
    const socket = MockSocket.instances[0]!;
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: 'subscribe', version: 1 });
    socket.frame({ type: 'ready', version: 1, connectionId: 'c1' });
    socket.frame({ type: 'resync_required', version: 1 });
    await vi.runOnlyPendingTimersAsync();
    expect(refreshChat).toHaveBeenCalled();
    expect(refreshPresence).toHaveBeenCalled();
    refreshChat.mockClear(); refreshPresence.mockClear();
    socket.frame({ type: 'invalidate', version: 1, connectionId: 'c1', sequence: 1,
      eventId: 'evt-1', worldInstanceId: 'world-a', channels: ['chat'] });
    await vi.runOnlyPendingTimersAsync();
    expect(refreshChat).toHaveBeenCalledOnce();
    expect(refreshPresence).not.toHaveBeenCalled();
    socket.frame({ type: 'invalidate', version: 1, connectionId: 'c1', sequence: 3,
      eventId: 'evt-3', worldInstanceId: 'world-a', channels: ['chat'] });
    await vi.runOnlyPendingTimersAsync();
    expect(refreshPresence).toHaveBeenCalledOnce(); // a gap forces a complete recovery
    socket.close();
    expect(transport.connectionState).toBe('polling');
    stopChat(); transport.dispose();
  });

  it('keeps character revision hints only for the open, in-sequence connection', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockSocket);
    const transport = new MuddRealtimeTransport(() => 'wss://x', () => 'world-a');
    transport.watch('character', vi.fn(), 15_000);
    const socket = MockSocket.instances[0]!;
    socket.open();
    socket.frame({ type: 'ready', version: 1, connectionId: 'c1' });
    expect(transport.revisionHint('character')).toBeUndefined();

    socket.frame({ type: 'invalidate', version: 2, connectionId: 'c1', sequence: 1,
      eventId: 'evt-1', worldInstanceId: 'world-a', channels: ['character'], revisions: { character: 7 } });
    expect(transport.revisionHint('character')).toBe(7);
    socket.frame({ type: 'invalidate', version: 2, connectionId: 'c1', sequence: 2,
      eventId: 'evt-2', worldInstanceId: 'world-a', channels: ['chat'] });
    expect(transport.revisionHint('character')).toBe(7);
    socket.frame({ type: 'invalidate', version: 2, connectionId: 'c1', sequence: 2,
      eventId: 'evt-2-replayed', worldInstanceId: 'world-a', channels: ['character'], revisions: { character: 9 } });
    expect(transport.revisionHint('character')).toBe(7);

    socket.frame({ type: 'resync_required', version: 1 });
    expect(transport.revisionHint('character')).toBeUndefined();
    socket.frame({ type: 'invalidate', version: 2, connectionId: 'c1', sequence: 3,
      eventId: 'evt-3', worldInstanceId: 'world-a', channels: ['character'], revisions: { character: 8 } });
    expect(transport.revisionHint('character')).toBe(8);

    socket.close();
    expect(transport.revisionHint('character')).toBeUndefined();
    transport.dispose();
  });

  it('does not apply a notification from an old world or connection', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockSocket);
    let world = 'world-a';
    const refresh = vi.fn(), transport = new MuddRealtimeTransport(() => 'wss://x', () => world);
    transport.watch('party', refresh, 3000);
    const socket = MockSocket.instances[0]!;
    socket.open(); socket.frame({ type: 'ready', version: 1, connectionId: 'old' });
    socket.frame({ type: 'invalidate', version: 1, connectionId: 'old', sequence: 1,
      eventId: 'evt', worldInstanceId: 'world-b', channels: ['party'] });
    expect(socket.readyState).toBe(3);
    world = 'world-b'; transport.dispose();
  });
});
