import { and, asc, eq } from 'drizzle-orm';
import { gameEvents } from './schema.js';
import { scheduleLegacyCorpseLifecycles } from './legacy-corpse-cleanup.js';

const MIGRATION_ID = 'schedule_legacy_orphan_corpses_v1';

async function runLegacyCorpseCleanup(): Promise<void> {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.MUDD_LEGACY_CORPSE_CLEANUP_TARGET !== 'production'
  ) {
    console.log(JSON.stringify({
      event: 'legacy_corpse_cleanup_skipped',
      reason: 'production_only',
    }));
    return;
  }

  const [{ db, pool }, { PostgresEventStore }] = await Promise.all([
    import('./client.js'),
    import('../persistence/postgres-event-store.js'),
  ]);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      ['mudd-data-migrations', MIGRATION_ID],
    );
    const applied = await client.query(
      'SELECT 1 FROM data_migrations WHERE id = $1',
      [MIGRATION_ID],
    );
    if ((applied.rowCount ?? 0) > 0) {
      await client.query('COMMIT');
      console.log(JSON.stringify({
        event: 'legacy_corpse_cleanup_skipped',
        reason: 'already_applied',
      }));
      return;
    }

    const worldRows = await db.selectDistinct({
      worldInstanceId: gameEvents.worldInstanceId,
    }).from(gameEvents)
      .where(and(
        eq(gameEvents.streamId, 'world-items'),
        eq(gameEvents.type, 'world.corpse_created'),
      ))
      .orderBy(asc(gameEvents.worldInstanceId));
    const store = new PostgresEventStore({ singleCallAppend: false });
    const summary = await scheduleLegacyCorpseLifecycles(
      store,
      worldRows.map(({ worldInstanceId }) => worldInstanceId),
    );

    await client.query(
      'INSERT INTO data_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [MIGRATION_ID],
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({
      event: 'legacy_corpse_cleanup_applied',
      migrationId: MIGRATION_ID,
      ...summary,
    }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((error as { code?: string }).code === '42P01') {
      throw new Error(
        'The data_migrations table is missing. Publish the schema update before starting the app.',
        { cause: error },
      );
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await runLegacyCorpseCleanup();
