import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '/tmp/mudd-web-style-results',
  use: { browserName: 'chromium', viewport: { width: 390, height: 844 } },
});
