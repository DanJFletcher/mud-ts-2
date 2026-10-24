import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, db } from './db/client.js';
import { gameEvents } from './db/schema.js';

describe('transactional realtime wakeups', () => {
  it('emits scoped routing metadata only after an event transaction commits', async () => {
    const listener = await pool.connect();
    const world = `realtime-test-${randomUUID()}`;
    const eventId = randomUUID();
    let resolve!: (payload: string | undefined) => void;
    const notice = new Promise<string | undefined>((done) => { resolve = done; });
    listener.on('notification', (message) => resolve(message.payload));
    await listener.query('LISTEN mudd_realtime');
    try {
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
      await db.delete(gameEvents).where((await import('drizzle-orm')).eq(gameEvents.eventId, eventId));
      await listener.query('UNLISTEN mudd_realtime');
      listener.release();
    }
  });
});

afterAll(async () => { await pool.end(); });
