import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const source = fileURLToPath(new URL('../src/', import.meta.url));
const ui = fileURLToPath(new URL('../../../packages/ui/src/styles.css', import.meta.url));

async function stylesheet(path: string): Promise<string> {
  const css = await readFile(path, 'utf8');
  const imports = [...css.matchAll(/@import\s+["']([^"']+)["'];/g)];
  let expanded = css.replace(/@import url\([^;]+;/g, '');
  for (const entry of imports) {
    const imported = entry[1].startsWith('.') ? await stylesheet(resolve(dirname(path), entry[1])) : '';
    expanded = expanded.replace(entry[0], imported);
  }
  return expanded;
}

async function renderArea(page: Page, styles: string[], markup: string) {
  await page.setContent(markup);
  await page.addStyleTag({ content: await stylesheet(ui) });
  for (const path of styles) await page.addStyleTag({ content: await stylesheet(resolve(source, path)) });
}

test('world recovery actions wrap with spacing without account CSS', async ({ page }) => {
  await renderArea(page, ['world/styles/index.css'], `<main class="focused-client"><div role="group" aria-label="World recovery" class="focused-session-recovery-actions"><button>Retry connection</button><button>Leave world</button></div></main>`);
  const recovery = page.getByRole('group', { name: 'World recovery' });
  await expect(recovery).toHaveCSS('display', 'flex');
  await expect(recovery).toHaveCSS('flex-wrap', 'wrap');
  await expect(recovery).toHaveCSS('gap', '8px');
});

test('account controls are styled without world CSS', async ({ page }) => {
  await renderArea(page, ['app/account.css', 'lobby/lobby.css'], `<main class="account-auth"><a class="account-link account-link--primary" href="/sign-in">Sign in</a></main>`);
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCSS('display', 'flex');
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCSS('min-height', '44px');
});

test('standalone Codex controls are styled without world CSS', async ({ page }) => {
  await renderArea(page, ['codex/codex.css'], `<main class="codex"><nav class="codex-nav"><a href="#regions">Regions</a></nav></main>`);
  await expect(page.getByRole('navigation')).toHaveCSS('display', 'flex');
  await expect(page.getByRole('link', { name: 'Regions' })).toHaveCSS('min-height', '44px');
});

for (const theme of ['light', 'dark']) {
  test(`Codex inherits distinct standalone and world palettes in ${theme} mode`, async ({ page }) => {
    await renderArea(page, ['world/styles/index.css', 'codex/codex.css'], `<main><section class="codex"><p>Standalone lore</p></section><section class="focused-client" data-theme="${theme}"><article class="codex"><p>World lore</p></article></section></main>`);
    await page.locator('html').evaluate((element, preference) => { element.dataset.theme = preference; }, theme);
    const colors = await page.locator('.codex').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
    expect(colors).toEqual(theme === 'light' ? ['rgb(32, 37, 31)', 'rgb(38, 59, 50)'] : ['rgb(239, 241, 233)', 'rgb(233, 237, 226)']);
  });
}

test('shared foundations preserve keyboard focus and reduced motion without world CSS', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await renderArea(page, ['app/styles/base.css', 'app/account.css'], '<main class="account-auth"><button>Continue</button></main>');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCSS('outline-style', 'solid');
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCSS('outline-width', '3px');
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCSS('animation-duration', '1e-05s');
});
