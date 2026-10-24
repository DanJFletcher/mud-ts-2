import { pool } from './db/client.js';
import type { RealtimeWakeup } from './realtime-gateway.js';
/** LISTEN is only a wakeup. Reconnect and periodic reconciliation recover loss. */
export function startRealtimeNotifications(invalidate: (change: RealtimeWakeup) => void, recover: () => void) {
  let stopped = false;
  let release: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    try {
      const client = await pool.connect();
      if (stopped) { client.release(); return; }
      release = () => client.release(true);
      client.on('notification', (message) => {
        if (!message.payload || message.payload.length > 1024) return;
        try { invalidate(JSON.parse(message.payload) as RealtimeWakeup); } catch { /* invalid payload is ignored */ }
      });
      client.once('error', () => {
        release?.(); release = undefined;
        if (!stopped) retry = setTimeout(() => void connect(), 1000);
      });
      await client.query('LISTEN mudd_realtime');
      recover();
    } catch {
      release?.(); release = undefined;
      if (!stopped) retry = setTimeout(() => void connect(), 1000);
    }
  };
  void connect();
  return () => { stopped = true; clearTimeout(retry); release?.(); };
}
