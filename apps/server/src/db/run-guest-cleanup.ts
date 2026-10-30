import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required for the guest account cleanup migration.');
}

const migrationSql = await readFile(
  fileURLToPath(new URL('../../drizzle/0013_guest_account_cleanup.sql', import.meta.url)),
  'utf8',
);
const pool = new Pool({ connectionString, max: 1 });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      ['mudd-data-migrations', 'cleanup_guest_accounts_v1'],
    );
    await client.query(migrationSql);
    await client.query('COMMIT');
    console.log('Guest account cleanup migration checked; applied at most once.');
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
  }
} finally {
  await pool.end();
}
