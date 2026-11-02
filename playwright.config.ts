import { defineConfig, devices } from '@playwright/test';

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
const apiPort = process.env.MUDD_E2E_API_PORT ?? '5001';
const webPort = process.env.MUDD_E2E_WEB_PORT ?? '5000';
const e2eEnv = {
  ...inheritedEnv,
  MUDD_E2E_AUTH: '1',
  NODE_ENV: 'test',
  API_PORT: apiPort,
  MUDD_E2E_API_PORT: apiPort,
  MUDD_E2E_WEB_PORT: webPort,
  CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort}`,
};

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev --workspace @mudd/server',
      url: `http://127.0.0.1:${apiPort}/api/worlds`,
      cwd: process.cwd(),
      env: e2eEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run preview --workspace @mudd/web',
      url: `http://127.0.0.1:${webPort}`,
      cwd: process.cwd(),
      env: e2eEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
