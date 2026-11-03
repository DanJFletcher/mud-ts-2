import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const evidenceDirectory = process.env.MUDD_STYLE_EVIDENCE ?? '/tmp/mudd-web-style-evidence';

async function captureAppearance(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const appearance = await page.locator('main, .codex, .focused-client, .lobby-shell').evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, font: style.fontFamily,
        display: style.display, width: Math.round(element.getBoundingClientRect().width) };
    }));
  await mkdir(evidenceDirectory, { recursive: true });
  const baseline = join(evidenceDirectory, `${name}.json`);
  if (process.env.MUDD_COMPARE_STYLE_BASELINE === '1') {
    expect(appearance).toEqual(JSON.parse(await readFile(baseline, 'utf8')));
  } else {
    await writeFile(baseline, JSON.stringify(appearance, null, 2));
  }
  await page.screenshot({ path: join(evidenceDirectory, `${name}-${process.env.MUDD_RECORD_STYLE_BASELINE === '1' ? 'before' : 'after'}.png`), fullPage: true, animations: 'disabled' });
}

test.describe('production PWA shell', () => {
  test.use({ serviceWorkers: 'allow' });
  test('updates its registration and serves the public shell offline', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'MUDD home' })).toBeVisible();
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('link', { name: 'MUDD home' })).toBeVisible();
    await expect(page.locator('.lobby-shell')).toHaveCSS('display', 'block');
    await context.setOffline(false);
  });
});

for (const width of [390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`area appearance at ${width}px in ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((preference) => localStorage.setItem('mudd-theme', preference), theme);
      const prefix = `${width}-${theme}`;
      await page.goto('/');
      await expect(page.getByRole('link', { name: 'MUDD home' })).toBeVisible();
      await captureAppearance(page, `${prefix}-home`);
      await page.goto('/worlds');
      await expect(page.getByRole('heading', { name: 'Explore worlds', exact: true })).toBeVisible();
      await captureAppearance(page, `${prefix}-lobby`);
      await page.goto('/codex');
      await expect(page.locator('.codex')).toBeVisible();
      await captureAppearance(page, `${prefix}-codex`);
      await page.goto('/worlds/mudd-demo-instance?create=1');
      await page.getByRole('button', { name: 'Play as guest' }).click();
      await page.getByLabel('Character name').fill(`Style ${width} ${theme}`);
      await page.getByRole('button', { name: 'Create & play' }).click();
      await expect(page.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
      await captureAppearance(page, `${prefix}-world`);
      if (width >= 700) {
        await page.getByRole('button', { name: 'Open terminal full screen', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Terminal', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Close full-screen terminal' }).click();
        await expect(page.getByRole('dialog', { name: 'Terminal', exact: true })).toBeHidden();
        await page.getByRole('button', { name: 'Collapse terminal', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Terminal output' })).toBeHidden();
        await page.getByRole('button', { name: 'Expand terminal', exact: true }).click();
      }
      await page.getByRole('button', { name: /^Open map full screen/ }).filter({ visible: true }).first().click();
      await expect(page.getByRole('dialog', { name: 'World map', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Close full-screen map' }).click();
      await expect(page.getByRole('dialog', { name: 'World map', exact: true })).toBeHidden();
      await page.getByRole('button', { name: 'Open chat full screen', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Room chat', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Message the room' })).toBeVisible();
      await page.getByRole('button', { name: 'Close full-screen chat' }).click();
      await expect(page.getByRole('dialog', { name: 'Room chat', exact: true })).toBeHidden();
      await page.evaluate(() => { location.hash = '/info/codex'; });
      await expect(page.locator('.codex')).toBeVisible();
      await captureAppearance(page, `${prefix}-embedded-codex`);
      expect(await page.evaluate(() => localStorage.getItem('mudd-theme'))).toBe(theme);
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.getByRole('button', { name: 'Characters', exact: true }).click();
      await expect(page.locator('.lobby-shell')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (width < 700) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.getByRole('link', { name: 'Codex', exact: true }).click();
      await expect(page.locator('.codex')).toBeVisible();
      await captureAppearance(page, `${prefix}-codex`);
      await page.locator('a[href="/worlds"]:visible').first().click();
      await expect(page.getByRole('heading', { name: 'Explore worlds', exact: true })).toBeVisible();
      if (width < 700) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.getByRole('button', { name: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme` }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
      await page.route('**/api/game', route => route.fulfill({ status: 503, json: { error: 'Temporary style-test outage' } }));
      await page.goto('/worlds/mudd-demo-instance');
      await page.getByRole('button', { name: `Play as Style ${width} ${theme}`, exact: true }).click();
      await expect(page.getByRole('heading', { name: 'World unavailable' })).toBeVisible();
      const recovery = page.locator('.focused-session-recovery-actions');
      await expect(recovery).toHaveCSS('display', 'flex');
      await expect(recovery).toHaveCSS('flex-wrap', 'wrap');
      await expect(recovery).toHaveCSS('gap', '8px');
      await expect(recovery.getByRole('button', { name: 'Characters', exact: true })).toBeVisible();
      await page.screenshot({ path: join(evidenceDirectory, `${prefix}-recovery-after.png`), animations: 'disabled' });
    });
  }
}
