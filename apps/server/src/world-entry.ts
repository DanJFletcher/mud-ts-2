import { and, eq, isNull, sql } from 'drizzle-orm';
import type { db as database } from './db/client.js';
import { characters, durableEffects, worldSessions } from './db/schema.js';
import { LOCATION_ENTERED_EFFECT } from './durable-effect-contracts.js';

/** Account/session transaction; gameplay eligibility is checked by the caller. */
export async function enterWorld(
  db: typeof database,
  input: { playerId: string; characterId: string; worldInstanceId: string; locationId?: string },
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM players WHERE id = ${input.playerId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM characters WHERE id = ${input.characterId} FOR UPDATE`);
    const [character] = await tx.select({ id: characters.id }).from(characters).where(and(
      eq(characters.id, input.characterId),
      eq(characters.playerId, input.playerId),
      eq(characters.worldInstanceId, input.worldInstanceId),
      isNull(characters.archivedAt),
    )).limit(1);
    if (!character) return { kind: 'missing' as const };
    const [current] = await tx.select().from(worldSessions).where(and(
      eq(worldSessions.playerId, input.playerId),
      eq(worldSessions.worldInstanceId, input.worldInstanceId),
    )).limit(1);
    if (current && current.characterId !== character.id) return { kind: 'occupied' as const };

    const [session] = current ? [current] : await tx.insert(worldSessions).values({
      id: globalThis.crypto.randomUUID(), playerId: input.playerId,
      worldInstanceId: input.worldInstanceId, characterId: character.id,
    }).returning();
    if (!session) throw new Error('Could not start the world session.');
    await tx.update(characters).set({ lastPlayedAt: sql`clock_timestamp()` })
      .where(eq(characters.id, character.id));
    if (!current && input.locationId) {
      await tx.insert(durableEffects).values({
        id: globalThis.crypto.randomUUID(), worldInstanceId: input.worldInstanceId,
        sourceStreamId: character.id, causationCommandId: session.id,
        effectType: LOCATION_ENTERED_EFFECT, effectVersion: 1,
        payload: { characterId: character.id, toLocationId: input.locationId },
        dedupeKey: `world-session:${session.id}`,
      });
    }
    return { kind: 'active' as const, session };
  });
}
