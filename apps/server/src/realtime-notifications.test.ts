import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createListenerClient } = vi.hoisted(() => ({ createListenerClient: vi.fn() }));

vi.mock('./db/client.js', () => ({ createListenerClient }));

import { startRealtimeNotifications } from './realtime-notifications.js';

class NotificationClient extends EventEmitter {
  connect = vi.fn(async () => undefined);
  query = vi.fn(async () => undefined);
  end = vi.fn(async () => undefined);
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

  it('listens on a dedicated client, recovers on connect, forwards valid payloads, and ignores invalid ones', async () => {
    const client = new NotificationClient();
    createListenerClient.mockReturnValue(client);
    const invalidate = vi.fn();
    const recover = vi.fn();
    const stop = startRealtimeNotifications(invalidate, recover);
    await flushConnection();

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith('LISTEN mudd_realtime');
    expect(recover).toHaveBeenCalledTimes(1);
    client.emit('notification', { payload: JSON.stringify({ worldInstanceId: 'world-1' }) });
    client.emit('notification', { payload: '{invalid json' });
    client.emit('notification', { payload: undefined });
    client.emit('notification', { payload: 'x'.repeat(1025) });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ worldInstanceId: 'world-1' });
    stop();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('reconnects once after a client error and closes each client on its lifecycle boundary', async () => {
    vi.useFakeTimers();
    const first = new NotificationClient();
    const second = new NotificationClient();
    createListenerClient.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const recover = vi.fn();
    const stop = startRealtimeNotifications(vi.fn(), recover);
    await flushConnection();

    first.emit('error', new Error('connection lost'));
    first.emit('error', new Error('connection lost again'));
    expect(first.end).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    await flushConnection();

    expect(createListenerClient).toHaveBeenCalledTimes(2);
    expect(second.query).toHaveBeenCalledWith('LISTEN mudd_realtime');
    expect(recover).toHaveBeenCalledTimes(2);
    stop();
    expect(second.end).toHaveBeenCalledOnce();
  });

  it('retries after connection or LISTEN failures and cancels retries when stopped', async () => {
    vi.useFakeTimers();
    const unreachable = new NotificationClient();
    unreachable.connect.mockRejectedValueOnce(new Error('database unavailable'));
    const listenFails = new NotificationClient();
    listenFails.query.mockRejectedValueOnce(new Error('listen failed'));
    createListenerClient.mockReturnValueOnce(unreachable).mockReturnValueOnce(listenFails);
    const recover = vi.fn();
    const stop = startRealtimeNotifications(vi.fn(), recover);
    await flushConnection();
    await vi.advanceTimersByTimeAsync(1000);
    await flushConnection();

    expect(createListenerClient).toHaveBeenCalledTimes(2);
    expect(unreachable.end).toHaveBeenCalledOnce();
    expect(listenFails.end).toHaveBeenCalledOnce();
    expect(recover).not.toHaveBeenCalled();

    stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(createListenerClient).toHaveBeenCalledTimes(2);
  });

  it('closes a client that finishes connecting after shutdown', async () => {
    let resolveConnection!: () => void;
    const client = new NotificationClient();
    client.connect.mockReturnValue(new Promise<undefined>((resolve) => {
      resolveConnection = () => resolve(undefined);
    }));
    createListenerClient.mockReturnValue(client);
    const stop = startRealtimeNotifications(vi.fn(), vi.fn());

    stop();
    resolveConnection();
    await flushConnection();

    expect(client.end).toHaveBeenCalledOnce();
    expect(client.query).not.toHaveBeenCalled();
  });
});
