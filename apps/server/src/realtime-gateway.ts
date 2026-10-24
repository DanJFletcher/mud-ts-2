import { randomUUID, createHash } from 'node:crypto';
import type { Request } from 'express';
import type { WebSocket } from 'ws';
import { RealtimeClientFrameSchema, type RealtimeChannel } from '@mudd/contracts';

export type RealtimeView = {
  worldInstanceId: string; characterId: string; playerId: string; roomId: string;
  expiresAt: number;
  values: Record<RealtimeChannel, unknown>;
};
export type RealtimeWakeup = {
  world: string; kind: 'character' | 'room' | 'interaction' | 'party' | 'team' | 'membership';
  characterId?: string; playerId?: string; roomId?: string;
};

/**
 * Transport adapter only. The injected read must authorize every view from
 * committed state. Notifications contain no game state and never run commands.
 */
export function createRealtimeGateway(
  read: (request: Request, channels: readonly RealtimeChannel[]) => Promise<RealtimeView | undefined>,
) {
  const clients = new Set<{
    world?: string; refresh: () => void; close: () => void;
    characterId?: string; playerId?: string; roomId?: string; channels: Set<RealtimeChannel>;
  }>();
  return {
    refreshAll() { for (const client of clients) client.refresh(); },
    invalidate(change: RealtimeWakeup) {
      for (const client of clients) {
        if (client.world !== change.world) continue;
        if (change.kind === 'membership' && client.playerId === change.playerId) { client.close(); continue; }
        const relevant = change.kind === 'character'
          ? client.characterId === change.characterId || (change.roomId && client.roomId === change.roomId)
          : change.kind === 'room' ? client.roomId === change.roomId
            : change.kind === 'interaction' ? client.channels.has('interactions')
              : change.kind === 'party' ? client.channels.has('party')
                : change.kind === 'team' ? client.channels.has('team') : false;
        if (relevant) client.refresh();
      }
    },
    close() { for (const client of clients) client.close(); clients.clear(); },
    connect(socket: WebSocket, request: Request) {
      if (clients.size >= 500) { socket.close(1013); return; }
      const connectionId = randomUUID();
      let sequence = 0, disposed = false, running = false, dirty = false;
      let channels: RealtimeChannel[] = [];
      let hashes: Partial<Record<RealtimeChannel, string>> = {};
      let characterId: string | undefined, playerId: string | undefined, roomId: string | undefined;
      const subscribed = new Set<RealtimeChannel>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      const close = () => {
        if (disposed) return;
        disposed = true; clearTimeout(timer); clearTimeout(expiry); clients.delete(client); socket.close();
      };
      const send = (frame: unknown) => {
        if (socket.readyState !== 1) return;
        if (socket.bufferedAmount > 64 * 1024) { close(); return; }
        socket.send(JSON.stringify(frame));
      };
      const refresh = async () => {
        if (disposed || !channels.length) return;
        if (running) { dirty = true; return; }
        running = true;
        try {
          const view = await read(request, channels);
          if (!view || (characterId && characterId !== view.characterId)) { close(); return; }
          clearTimeout(expiry);
          expiry = setTimeout(close, Math.max(0, view.expiresAt - Date.now()));
          expiry.unref();
          if (!characterId) {
            send({ type: 'ready', version: 1, connectionId });
            send({ type: 'resync_required', version: 1 });
          }
          characterId = view.characterId; playerId = view.playerId; roomId = view.roomId;
          client.world = view.worldInstanceId; client.characterId = characterId;
          client.playerId = playerId; client.roomId = roomId;
          const changed: RealtimeChannel[] = [];
          for (const channel of channels) {
            const hash = createHash('sha256').update(JSON.stringify(view.values[channel]) ?? 'null').digest('hex');
            if (hashes[channel] !== hash) changed.push(channel);
            hashes[channel] = hash;
          }
          if (changed.length) send({ type: 'invalidate', version: 1, connectionId,
            sequence: ++sequence, eventId: randomUUID(), worldInstanceId: view.worldInstanceId, channels: changed });
        } catch { close(); }
        finally {
          running = false;
          if (dirty && !disposed) { dirty = false; client.refresh(); }
        }
      };
      const client = {
        world: undefined as string | undefined,
        characterId: undefined as string | undefined,
        playerId: undefined as string | undefined,
        roomId: undefined as string | undefined,
        close, refresh: () => {
        if (timer || disposed) return;
        timer = setTimeout(() => { timer = undefined; void refresh(); }, 75);
        }, channels: subscribed,
      };
      clients.add(client);
      socket.on('message', (data) => {
        if (data.toString().length > 1024) { close(); return; }
        try {
          const frame = RealtimeClientFrameSchema.parse(JSON.parse(data.toString()));
          const requested = [...new Set(frame.channels)];
          if (channels.length && !channels.every((channel) => requested.includes(channel))) { close(); return; }
          const initial = channels.length === 0;
          const added = requested.some((channel) => !subscribed.has(channel));
          if (!initial && !added) return;
          channels = requested;
          channels.forEach((channel) => subscribed.add(channel));
          if (initial) hashes = {};
          // Additive subscription changes; removals require a fresh connection.
          void refresh();
        } catch { close(); }
      });
      socket.on('close', close);
      socket.on('error', close);
    },
  };
}
