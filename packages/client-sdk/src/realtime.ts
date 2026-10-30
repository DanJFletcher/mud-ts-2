import { RealtimeServerFrameSchema, type RealtimeChannel, type RealtimeRevisionHints } from '@mudd/contracts';

type Watcher = { channel: RealtimeChannel; run: () => Promise<unknown> | void; ready: () => boolean; dirty: boolean; running: boolean; next: number; interval: number };
/** One connection per SDK client. HTTP callbacks remain the recovery authority. */
export class MuddRealtimeTransport {
  private socket?: WebSocket;
  private watchers = new Set<Watcher>();
  private timer?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private connectionId = '';
  private sequence = 0;
  private healthy = false;
  private sentChannels = new Set<RealtimeChannel>();
  // Scoped to the open connection; cleared whenever it may have missed frames.
  private revisionHints: RealtimeRevisionHints = {};
  constructor(private url: () => string, private world: () => string) {}
  get connectionState(): 'connected' | 'connecting' | 'polling' {
    return this.healthy ? 'connected' : this.socket ? 'connecting' : 'polling';
  }
  /** Latest revision the server reported for a channel on the healthy connection. */
  revisionHint(channel: keyof RealtimeRevisionHints): number | undefined {
    return this.healthy ? this.revisionHints[channel] : undefined;
  }

  watch(channel: RealtimeChannel, run: Watcher['run'], interval: number, ready = () => true) {
    const watcher = { channel, run, interval, ready, dirty: true, running: false, next: 0 };
    this.watchers.add(watcher);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 250);
    this.reconcileChannels();
    if (!this.socket && !this.reconnect) this.connect();
    this.tick();
    return () => {
      this.watchers.delete(watcher);
      if (!this.watchers.size) this.dispose();
      else {
        const desired = new Set([...this.watchers].map((entry) => entry.channel));
        if ([...this.sentChannels].some((channel) => !desired.has(channel))) {
          // The server's subscription contract is additive; reconnect to remove
          // stale channels rather than continuing to read them for this client.
          this.sentChannels.clear();
          this.socket?.close();
        }
      }
    };
  }
  private tick() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    for (const watcher of this.watchers) {
      if (watcher.running || !watcher.ready() ||
          (!watcher.dirty && (this.healthy || Date.now() < watcher.next))) continue;
      watcher.dirty = false; watcher.running = true; watcher.next = Date.now() + watcher.interval;
      Promise.resolve().then(watcher.run).catch(() => { watcher.next = Date.now() + watcher.interval; this.healthy = false; })
        .finally(() => { watcher.running = false; });
    }
  }
  private connect() {
    if (typeof WebSocket === 'undefined' || !this.watchers.size) return;
    let socket: WebSocket;
    try { socket = new WebSocket(this.url()); } catch { this.retry(); return; }
    this.socket = socket;
    socket.onopen = () => { this.sentChannels.clear(); this.reconcileChannels(); };
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket || typeof data !== 'string' || data.length > 8192) return;
      try {
        const frame = RealtimeServerFrameSchema.parse(JSON.parse(data));
        if (frame.type === 'ready') {
          this.connectionId = frame.connectionId; this.sequence = 0; this.healthy = true; this.attempt = 0;
          this.revisionHints = {};
        } else if (frame.type === 'resync_required') {
          this.revisionHints = {};
          for (const watcher of this.watchers) watcher.dirty = true;
        } else {
          if (frame.worldInstanceId !== this.world() || frame.connectionId !== this.connectionId) throw new Error('Scope changed');
          if (frame.sequence <= this.sequence) return;
          if (frame.revisions) this.revisionHints = { ...this.revisionHints, ...frame.revisions };
          if (frame.sequence !== this.sequence + 1) {
            for (const watcher of this.watchers) watcher.dirty = true;
          } else for (const watcher of this.watchers) {
            if (frame.channels.includes(watcher.channel)) watcher.dirty = true;
          }
          this.sequence = frame.sequence;
        }
        this.tick();
      } catch { socket.close(); }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined; this.healthy = false; this.revisionHints = {};
      for (const watcher of this.watchers) watcher.dirty = true;
      this.retry();
    };
  }
  private reconcileChannels() {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    const channels = [...new Set([...this.watchers].map((watcher) => watcher.channel))];
    if (channels.length === this.sentChannels.size && channels.every((channel) => this.sentChannels.has(channel))) return;
    channels.forEach((channel) => this.sentChannels.add(channel));
    socket.send(JSON.stringify({ type: 'subscribe', version: 1, channels: [...this.sentChannels] }));
  }
  private retry() {
    if (!this.watchers.size) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5)) * (.75 + Math.random() * .5);
    this.reconnect = setTimeout(() => { this.reconnect = undefined; this.connect(); }, delay);
  }
  dispose() {
    clearInterval(this.timer); clearTimeout(this.reconnect);
    this.timer = undefined; this.reconnect = undefined; this.healthy = false;
    this.revisionHints = {};
    this.sentChannels.clear();
    this.watchers.clear();
    const socket = this.socket; this.socket = undefined; socket?.close();
  }
}
