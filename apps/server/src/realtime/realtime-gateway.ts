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

type GatewayClient = {
  world?: string; close: () => void;
  /** Re-read the given channels (default: all subscribed) after a short debounce. */
  refresh: (affected?: Iterable<RealtimeChannel>) => void;
  characterId?: string; playerId?: string; roomId?: string; channels: Set<RealtimeChannel>;
};

/**
 * The channels a wakeup can change for one client. A change to the client's own
 * character may move it to another room, so it rereads everything. Another
 * character's change in the room can only alter who is present; chat messages
 * and NPC movement arrive as room wakeups, which change presence or chat at most.
 */
function affectedChannels(change: RealtimeWakeup, client: GatewayClient): readonly RealtimeChannel[] | 'all' {
  switch (change.kind) {
    case 'character':
      if (client.characterId === change.characterId) return 'all';
      return change.roomId && client.roomId === change.roomId ? ['presence'] : [];
    case 'room': return client.roomId === change.roomId ? ['presence', 'chat'] : [];
    case 'interaction': return ['interactions'];
    case 'party': return ['party'];
    case 'team': return ['team'];
    default: return [];
  }
}

/**
 * Transport adapter only. The injected read must authorize every view from
 * committed state. Notifications contain no game state and never run commands.
 */
export function createRealtimeGateway(
  read: (request: Request, channels: readonly RealtimeChannel[]) => Promise<RealtimeView | undefined>,
) {
  const clients = new Set<GatewayClient>();
  return {
    refreshAll() { for (const client of clients) client.refresh(); },
    invalidate(change: RealtimeWakeup) {
      for (const client of clients) {
        if (client.world !== change.world) continue;
        if (change.kind === 'membership' && client.playerId === change.playerId) { client.close(); continue; }
        const affected = affectedChannels(change, client);
        if (affected === 'all') client.refresh();
        else if (affected.length) client.refresh(affected);
      }
    },
    close() { for (const client of clients) client.close(); clients.clear(); },
    connect(socket: WebSocket, request: Request, options: { protocolVersion?: 1 | 2 } = {}) {
      const protocolVersion = options.protocolVersion ?? 1;
      if (clients.size >= 500) { socket.close(1013); return; }
      const connectionId = randomUUID();
      let sequence = 0, disposed = false, running = false;
      let channels: RealtimeChannel[] = [];
      let hashes: Partial<Record<RealtimeChannel, string>> = {};
      let characterId: string | undefined, playerId: string | undefined, roomId: string | undefined;
      const subscribed = new Set<RealtimeChannel>();
      // Channels marked by wakeups since the last read; each read covers only these.
      const pending = new Set<RealtimeChannel>();
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
        // A read in progress picks up channels marked meanwhile when it finishes.
        if (running) return;
        const reading = channels.filter((channel) => pending.has(channel));
        pending.clear();
        if (!reading.length) return;
        running = true;
        try {
          const view = await read(request, reading);
          if (!view || (characterId && characterId !== view.characterId)) { close(); return; }
          clearTimeout(expiry);
          expiry = setTimeout(close, Math.max(0, view.expiresAt - Date.now()));
          expiry.unref();
          if (!characterId) {
            send({ type: 'ready', version: 1, connectionId });
            send({ type: 'resync_required', version: 1 });
          }
          // Room-scoped channels depend on where the character is; reread them after a move.
          if (roomId !== undefined && roomId !== view.roomId) {
            for (const channel of ['presence', 'chat'] as const) {
              if (subscribed.has(channel) && !reading.includes(channel)) pending.add(channel);
            }
          }
          characterId = view.characterId; playerId = view.playerId; roomId = view.roomId;
          client.world = view.worldInstanceId; client.characterId = characterId;
          client.playerId = playerId; client.roomId = roomId;
          const changed: RealtimeChannel[] = [];
          for (const channel of reading) {
            const hash = createHash('sha256').update(JSON.stringify(view.values[channel]) ?? 'null').digest('hex');
            if (hashes[channel] !== hash) changed.push(channel);
            hashes[channel] = hash;
          }
          // Protocol 2 adds the character revision so a client that already holds
          // it, typically from its own command response, can skip the refetch.
          const characterRevision = view.values.character;
          const revisions = protocolVersion === 2 && changed.includes('character') &&
            typeof characterRevision === 'number' ? { character: characterRevision } : undefined;
          if (changed.length) send({ type: 'invalidate', version: protocolVersion, connectionId,
            sequence: ++sequence, eventId: randomUUID(), worldInstanceId: view.worldInstanceId, channels: changed,
            ...(revisions ? { revisions } : {}) });
        } catch { close(); }
        finally {
          running = false;
          if (pending.size && !disposed) client.refresh([]);
        }
      };
      const client: GatewayClient = {
        world: undefined,
        characterId: undefined,
        playerId: undefined,
        roomId: undefined,
        close, refresh: (affected = subscribed) => {
          for (const channel of affected) if (subscribed.has(channel)) pending.add(channel);
          if (!pending.size || timer || disposed) return;
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
          channels.forEach((channel) => { subscribed.add(channel); pending.add(channel); });
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
