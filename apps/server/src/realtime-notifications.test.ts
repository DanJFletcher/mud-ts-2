import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { pool } = vi.hoisted(() => ({ pool: { connect: vi.fn() } }));

vi.mock('./db/client.js', () => ({ pool }));

import { startRealtimeNotifications } from './realtime-notifications.js';

class NotificationClient extends EventEmitter {
  query = vi.fn(async () => undefined);
  release = vi.fn();
}

async function flushConnection(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('realtime notification listener', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('listens, recovers on connect, forwards valid payloads, and ignores invalid ones', async () => {
    const client = new NotificationClient();
    pool.connect.mockResolvedValue(client);
    const invalidate = vi.fn();
    const recover = vi.fn();
    const stop = startRealtimeNotifications(invalidate, recover);
    await flushConnection();

    expect(client.query).toHaveBeenCalledWith('LISTEN mudd_realtime');
    expect(recover).toHaveBeenCalledTimes(1);
    client.emit('notification', { payload: JSON.stringify({ worldInstanceId: 'world-1' }) });
    client.emit('notification', { payload: '{invalid json' });
    client.emit('notification', { payload: undefined });
    client.emit('notification', { payload: 'x'.repeat(1025) });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ worldInstanceId: 'world-1' });
    stop();
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('reconnects after a client error and releases both clients on their lifecycle boundaries', async () => {
    vi.useFakeTimers();
    const first = new NotificationClient();
    const second = new NotificationClient();
    pool.connect.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const recover = vi.fn();
    const stop = startRealtimeNotifications(vi.fn(), recover);
    await flushConnection();

    first.emit('error', new Error('connection lost'));
    expect(first.release).toHaveBeenCalledWith(true);
    await vi.advanceTimersByTimeAsync(1000);
    await flushConnection();

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(second.query).toHaveBeenCalledWith('LISTEN mudd_realtime');
    expect(recover).toHaveBeenCalledTimes(2);
    stop();
    expect(second.release).toHaveBeenCalledWith(true);
  });

  it('retries after connection or LISTEN failures and cancels retries when stopped', async () => {
    vi.useFakeTimers();
    const client = new NotificationClient();
    client.query.mockRejectedValueOnce(new Error('listen failed'));
    pool.connect.mockRejectedValueOnce(new Error('pool unavailable')).mockResolvedValueOnce(client);
    const recover = vi.fn();
    const stop = startRealtimeNotifications(vi.fn(), recover);
    await flushConnection();
    await vi.advanceTimersByTimeAsync(1000);
    await flushConnection();

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(recover).not.toHaveBeenCalled();

    stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });

  it('releases a client that finishes connecting after shutdown', async () => {
    let resolveConnection!: (client: NotificationClient) => void;
    pool.connect.mockReturnValue(new Promise((resolve) => { resolveConnection = resolve; }));
    const client = new NotificationClient();
    const stop = startRealtimeNotifications(vi.fn(), vi.fn());

    stop();
    resolveConnection(client);
    await flushConnection();

    expect(client.release).toHaveBeenCalledWith();
    expect(client.query).not.toHaveBeenCalled();
  });
});
