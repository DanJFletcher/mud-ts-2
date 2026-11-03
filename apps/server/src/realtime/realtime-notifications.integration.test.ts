import { randomUUID } from 'node:crypto';
import type { Notification } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, db } from '../db/client.js';
import { gameEvents } from '../db/schema.js';

describe('transactional realtime wakeups', () => {
  it('emits scoped routing metadata only after an event transaction commits', async () => {
    const listener = await pool.connect();
    const world = `realtime-test-${randomUUID()}`;
    const eventId = randomUUID();
    let resolve!: (payload: string | undefined) => void;
    const notice = new Promise<string | undefined>((done) => { resolve = done; });
    const onNotification = (message: Notification) => {
      if (JSON.parse(message.payload ?? 'null')?.world === world) resolve(message.payload);
    };
    listener.on('notification', onNotification);
    await listener.query('LISTEN mudd_realtime');
    try {
      await listener.query('SELECT pg_notify($1, $2)', [
        'mudd_realtime', JSON.stringify({ world: `unrelated-${randomUUID()}`, kind: 'membership' }),
      ]);
      await db.insert(gameEvents).values({
        eventId, worldInstanceId: world, streamId: 'world-team-combat', streamVersion: 1,
        type: 'team.combat.started', contractVersion: 1, payload: { secret: 'must-not-be-published' },
        causationCommandId: randomUUID(), actorId: randomUUID(), occurredAt: new Date(), tick: 1,
      });
      const payload = await Promise.race([
        notice,
        new Promise<undefined>((resolveTimeout) => setTimeout(() => resolveTimeout(undefined), 1500)),
      ]);
      expect(JSON.parse(payload ?? 'null')).toEqual({ world, kind: 'team' });
      expect(payload).not.toContain('secret');
    } finally {
      listener.removeListener('notification', onNotification);
      await db.delete(gameEvents).where((await import('drizzle-orm')).eq(gameEvents.eventId, eventId));
      await listener.query('UNLISTEN mudd_realtime');
      listener.release();
    }
  });
});

afterAll(async () => { await pool.end(); });
