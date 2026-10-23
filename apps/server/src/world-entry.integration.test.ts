import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { enterWorld } from './world-entry.js';
import { characters, durableEffects, players, worldSessions } from './db/schema.js';

const testDatabaseUrl = process.env.MUDD_TEST_DATABASE_URL;
(testDatabaseUrl ? describe : describe.skip)('account world entry (PostgreSQL)', () => {
  let db: typeof import('./db/client.js').db;
  let pool: typeof import('./db/client.js').pool;
  const owner = randomUUID(), other = randomUUID();
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const world = `lobby-${randomUUID()}`, secondWorld = `lobby-${randomUUID()}`;
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    ({ db, pool } = await import('./db/client.js'));
    await db.insert(players).values([{ id: owner, displayName: 'Owner' }, { id: other, displayName: 'Other' }]);
    await db.insert(characters).values(ids.map((id, i) => ({
      id, playerId: owner, worldInstanceId: i === 3 ? secondWorld : world,
      name: `Traveler ${i}`, archivedAt: i === 2 ? new Date() : null,
    })));
  });
  afterAll(async () => {
    if (!db) return;
    await db.delete(durableEffects).where(inArray(durableEffects.worldInstanceId, [world, secondWorld]));
    await db.delete(players).where(inArray(players.id, [owner, other]));
    await pool.end();
  });
  const read = async (id: string) => (await db.select().from(characters).where(eq(characters.id, id)))[0]!;
  it('keeps historical timestamps null and rejected entries do not modify history', async () => {
    expect((await read(ids[0]!)).lastPlayedAt).toBeNull();
    for (const input of [
      { playerId: other, characterId: ids[0]!, worldInstanceId: world },
      { playerId: owner, characterId: ids[2]!, worldInstanceId: world },
      { playerId: owner, characterId: ids[0]!, worldInstanceId: secondWorld },
    ]) expect((await enterWorld(db, input)).kind).toBe('missing');
    expect((await read(ids[0]!)).lastPlayedAt).toBeNull();
    expect((await read(ids[2]!)).lastPlayedAt).toBeNull();
  });
  it('records successful entry/resume, serializes occupied sessions and preserves other worlds', async () => {
    const input = { playerId: owner, characterId: ids[0]!, worldInstanceId: world, locationId: 'start' };
    expect((await enterWorld(db, input)).kind).toBe('active');
    const first = (await read(ids[0]!)).lastPlayedAt!;
    expect(first).toBeInstanceOf(Date);
    expect((await enterWorld(db, { ...input, characterId: ids[1]! })).kind).toBe('occupied');
    expect((await read(ids[1]!)).lastPlayedAt).toBeNull();
    expect((await enterWorld(db, input)).kind).toBe('active');
    expect((await read(ids[0]!)).lastPlayedAt!.getTime()).toBeGreaterThanOrEqual(first.getTime());
    expect(await db.select().from(durableEffects).where(eq(durableEffects.worldInstanceId, world))).toHaveLength(1);
    await enterWorld(db, { playerId: owner, characterId: ids[3]!, worldInstanceId: secondWorld });
    expect(await db.select().from(worldSessions).where(eq(worldSessions.playerId, owner))).toHaveLength(2);
    await db.delete(worldSessions).where(eq(worldSessions.worldInstanceId, world));
    expect((await db.select().from(worldSessions).where(eq(worldSessions.playerId, owner)))[0]?.worldInstanceId).toBe(secondWorld);
  });
});
