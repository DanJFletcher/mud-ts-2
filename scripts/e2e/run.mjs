import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const root = new URL('../../', import.meta.url);
const cwd = new URL(root).pathname;
const containerName = `mudd-e2e-${process.pid}-${randomUUID().slice(0, 8)}`;
const databasePassword = randomBytes(24).toString('hex');
const sessionSecret = randomBytes(32).toString('hex');
const env = { ...process.env };
delete env.CLERK_SECRET_KEY;
delete env.CLERK_PUBLISHABLE_KEY;
delete env.VITE_CLERK_PUBLISHABLE_KEY;
delete env.VITE_CLERK_PROXY_URL;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...env, ...options.env },
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
  });
  if (result.error) throw result.error;
  return result;
}

function runChecked(command, args, options) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}.`);
  }
  return result;
}

async function waitForDatabase() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = run('docker', ['exec', containerName, 'pg_isready', '-U', 'e2e', '-d', 'mudd_e2e'], {
      stdio: 'ignore',
    });
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('The isolated E2E PostgreSQL container did not become ready within 30 seconds.');
}

async function allocatePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a localhost port.');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

let containerStarted = false;
let exitCode = 1;
try {
  const docker = run('docker', ['info'], { stdio: 'ignore' });
  if (docker.status !== 0) {
    throw new Error('Docker must be running to start the isolated E2E PostgreSQL database.');
  }

  runChecked('npm', ['run', 'build'], {
    env: { MUDD_E2E_AUTH: '1', NODE_ENV: 'production' },
  });

  runChecked('docker', [
    'run', '--rm', '--detach',
    '--name', containerName,
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_USER=e2e',
    '--env', `POSTGRES_PASSWORD=${databasePassword}`,
    '--env', 'POSTGRES_DB=mudd_e2e',
    'postgres:16',
  ], { stdio: 'ignore' });
  containerStarted = true;

  const mapping = runChecked('docker', ['port', containerName, '5432/tcp'], {
    stdio: 'pipe',
    encoding: 'utf8',
  }).stdout.trim();
  const port = mapping.match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port) throw new Error('Docker did not report the isolated database port bound to localhost.');

  await waitForDatabase();
  const databaseUrl = `postgresql://e2e:${databasePassword}@127.0.0.1:${port}/mudd_e2e`;
  const apiPort = await allocatePort();
  const webPort = await allocatePort();
  const testEnv = {
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: sessionSecret,
    MUDD_E2E_AUTH: '1',
    NODE_ENV: 'test',
    API_PORT: String(apiPort),
    MUDD_E2E_API_PORT: String(apiPort),
    MUDD_E2E_WEB_PORT: String(webPort),
    CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort}`,
  };
  runChecked('npm', ['run', 'db:migrate', '--workspace', '@mudd/server'], { env: testEnv });
  const tests = run('npm', ['run', 'test:e2e:playwright'], { env: testEnv });
  exitCode = tests.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'E2E test setup failed.');
} finally {
  if (containerStarted) {
    const removed = run('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
    if (removed.status !== 0) {
      console.error(`Could not stop the isolated E2E database container ${containerName}.`);
      exitCode = 1;
    }
  }
}

process.exitCode = exitCode;
