import { createListenerClient } from './db/client.js';
import type { RealtimeWakeup } from './realtime-gateway.js';
/** LISTEN is only a wakeup. Reconnect and periodic reconciliation recover loss. */
export function startRealtimeNotifications(
  invalidate: (change: RealtimeWakeup) => void,
  recover: () => void,
  connectionState: (connected: boolean) => void = () => undefined,
) {
  let stopped = false;
  let release: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    // A dedicated connection, so LISTEN never occupies one of the pool's query slots.
    const client = createListenerClient();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      void client.end().catch(() => undefined);
    };
    const reconnect = () => {
      if (closed) return;
      connectionState(false);
      if (release === close) release = undefined;
      close();
      if (!stopped) retry = setTimeout(() => void connect(), 1000);
    };
    client.on('error', reconnect);
    try {
      await client.connect();
      if (stopped) { close(); return; }
      release = close;
      client.on('notification', (message) => {
        if (!message.payload || message.payload.length > 1024) return;
        try { invalidate(JSON.parse(message.payload) as RealtimeWakeup); } catch { /* invalid payload is ignored */ }
      });
      await client.query('LISTEN mudd_realtime');
      connectionState(true);
      recover();
    } catch {
      reconnect();
    }
  };
  void connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    connectionState(false);
    release?.();
  };
}
