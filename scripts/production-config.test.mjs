import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { readMigrationFiles } from 'drizzle-orm/migrator';

const root = new URL('../', import.meta.url);

test('deployment exclusions preserve compiled apps and runtime dependencies', () => {
  const exclusions = readFileSync(new URL('.replitignore', root), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const exclusion of exclusions) {
    assert.doesNotMatch(exclusion, /(?:node_modules|dist)/);
  }
});

test('public HTTP port forwards to the game, not the design sandbox', () => {
  const config = readFileSync(new URL('.replit', root), 'utf8');
  const publicPort = config.split('[[ports]]').slice(1)
    .find((section) => /^externalPort = 80$/m.test(section));
  assert.ok(publicPort, 'A public HTTP port must be configured');
  assert.match(publicPort, /^localPort = 5000$/m);
});

test('production build includes the server, PWA, migration runner and SQL journal', () => {
  for (const path of [
    'apps/server/dist/index.js',
    'apps/server/dist/db/migrate.js',
    'apps/web/dist/index.html',
  ]) {
    assert.ok(existsSync(new URL(path, root)), `Missing production output: ${path}`);
  }
  const migrations = readMigrationFiles({
    migrationsFolder: new URL('apps/server/drizzle/', root).pathname,
  });
  assert.ok(migrations.length > 0);
  const require = createRequire(new URL('apps/server/package.json', root));
  for (const dependency of ['express', 'pg', 'drizzle-orm/node-postgres/migrator']) {
    assert.ok(require.resolve(dependency));
  }
});
