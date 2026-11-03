import { expect, test, type Page } from '@playwright/test';

async function createGuestWorld(
  page: Page,
  worldInstanceId = 'mudd-demo-instance',
  characterName = 'E2E Wayfarer',
) {
  await page.goto(`/worlds/${worldInstanceId}?create=1`);

  await page.getByRole('button', { name: 'Play as guest' }).click();
  await page.getByLabel('Character name').fill(characterName);
  if (worldInstanceId === 'orraveth-bellwold-instance') {
    await page.getByRole('radio').first().check();
  }
  await page.getByRole('button', { name: 'Create & play' }).click();
  await expect(page.getByRole('heading', {
    name: worldInstanceId === 'orraveth-bellwold-instance'
      ? 'Bellwold Market Square'
      : 'Mossgate Clearing',
  })).toBeVisible();
}

async function clickQuickAction(page: Page, name: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const action = page.getByRole('button', { name, exact: true });
    if (await action.count()) {
      await action.click();
      return;
    }
    const group = page.getByRole('group', { name: /^Quick commands, page \d+$/ });
    const currentPage = Number((await group.getAttribute('aria-label'))?.match(/page (\d+)/)?.[1] ?? 1);
    const nextPage = page.getByRole('button', { name: `Show quick actions page ${currentPage + 1}` });
    if (!await nextPage.count()) break;
    await nextPage.click();
  }
  throw new Error(`Quick action "${name}" is not available.`);
}

test('guest creates a character, explores, and can leave and re-enter the world', async ({ page }) => {
  await createGuestWorld(page);
  const marker = page.getByRole('button', {
    name: 'Choose an action for Weathered marker in terminal',
  });
  await marker.click();
  const markerDialog = page.getByRole('dialog', { name: 'Choose an action for Weathered marker' });
  await markerDialog.getByRole('button', { name: 'Close' }).click();
  await expect(markerDialog).toBeHidden();
  await expect(marker).toBeFocused();

  await marker.click();
  await markerDialog.getByRole('button', { name: 'Read' }).click();
  await expect(markerDialog).toBeHidden();

  const command = page.getByRole('textbox', { name: 'Enter a command' });
  await command.fill('talk Mara');
  await command.press('Enter');
  const dialogue = page.getByRole('dialog', { name: 'Conversation with Mara' });
  await expect(dialogue).toBeVisible();
  await dialogue.getByRole('button', { name: 'Close conversation' }).click();
  await expect(dialogue).toBeHidden();
  await expect(command).toBeFocused();

  await command.evaluate((input: HTMLInputElement) => input.blur());
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('heading', { name: 'Willowshade Track' })).toBeVisible();

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Characters' }).click();
  await expect(page.getByRole('button', { name: 'Play as E2E Wayfarer' })).toBeVisible();
  await page.getByRole('button', { name: 'Play as E2E Wayfarer' }).click();
  await expect(page.getByRole('heading', { name: 'Willowshade Track' })).toBeVisible();
});

test('Orraveth bulletin Read opens the linked postings and preserves legacy HTTP clients', async ({ page }) => {
  await createGuestWorld(page, 'orraveth-bellwold-instance', 'E2E Bulletin Reader');
  await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('button', { name: 'South', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bellwold South Common' })).toBeVisible();
  const queries: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/queries') && request.postDataJSON()?.type === 'daily.board') {
      queries.push(request.postDataJSON().payload.boardId);
    }
  });
  await page.getByRole('button', { name: 'Choose an action for Bulletin board in terminal' }).click();
  const chooser = page.getByRole('dialog', { name: 'Choose an action for Bulletin board' });
  await chooser.getByRole('button', { name: 'Read', exact: true }).click();
  const board = page.getByRole('dialog', { name: 'South Common bulletin board' });
  await expect(board).toBeVisible();
  await expect(board.getByRole('button', { name: 'Accept', exact: true }).first()).toBeVisible();
  expect(queries).toEqual(['bellwold-notice-board']);
  await board.getByRole('button', { name: 'Accept', exact: true }).first().click();
  await expect(board.getByText('In progress')).toBeVisible();
  await board.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('heading', { name: 'Bellwold South Common' })).toBeVisible();
  for (const version of [undefined, '1', '2']) {
    const response = await page.request.get('/api/game', { headers: {
      'x-mudd-world-instance': 'orraveth-bellwold-instance', ...(version ? { 'x-mudd-readable-actions': version } : {}),
    } });
    expect(response.ok()).toBe(true);
    const object = (await response.json()).location.objects.find((entry: { id: string }) => entry.id === 'bellwold-daily-notice');
    expect(object.readAction).toEqual(version === '1' ? { type: 'daily-board', boardId: 'bellwold-notice-board' } : undefined);
  }
  await board.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(board).toBeHidden();
  await page.getByRole('button', { name: 'Choose an action for Bulletin board in terminal' }).click();
  await chooser.getByRole('button', { name: 'Look', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Terminal output' })).toContainText('A broad plank board holds handwritten notices');
  expect(queries.every((id) => id === 'bellwold-notice-board')).toBe(true);
});

test('mobile history stays bounded and navigation does not replay activity announcements', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createGuestWorld(page);
  await page.getByRole('button', { name: 'Type' }).click();
  const command = page.getByRole('textbox', { name: 'Enter a command' });
  for (let index = 0; index < 10; index += 1) {
    await command.fill('help');
    await command.press('Enter');
  }

  const terminal = page.getByRole('region', { name: 'Terminal output' });
  const rows = terminal.locator('[data-activity-entry]');
  await expect(rows).toHaveCount(200);
  await expect(page.getByRole('region', { name: 'Terminal transcript' })).toHaveAttribute('aria-live', 'off');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const announcement = page.getByRole('status', { name: 'New activity' });
  const beforeNavigation = await announcement.innerHTML();
  await terminal.getByRole('button', { name: 'Older' }).click();
  expect(await announcement.innerHTML()).toBe(beforeNavigation);
  const anchor = await rows.first().getAttribute('data-activity-entry');

  await command.fill('help');
  await command.press('Enter');
  await expect(announcement).toContainText('New activity received.');
  await expect(rows.first()).toHaveAttribute('data-activity-entry', anchor!);
});

test('guest can obtain a fishing rod and cancel a cast', async ({ page }) => {
  await createGuestWorld(page, 'orraveth-bellwold-instance', 'E2E Angler');

  const navigation = page.getByRole('navigation', { name: 'Quick navigation' });
  await navigation.getByRole('button', { name: 'South', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bellwold South Common' })).toBeVisible();

  const command = page.getByRole('textbox', { name: 'Enter a command' });
  await command.fill('talk Orin');
  await command.press('Enter');
  const dialogue = page.getByRole('dialog', { name: 'Conversation with Orin Vale' });
  await expect(dialogue).toBeVisible();
  await dialogue.getByRole('button', { name: 'Accept the old rod' }).click();
  await expect(dialogue).toContainText('Here you are');
  await dialogue.getByRole('button', { name: 'Close conversation' }).click();
  await expect(dialogue).toBeHidden();

  const destinations = [
    'Bellwold Well Court',
    'Bellwold Common House',
    'Bellwold South Gate',
    'Southbound Track',
    'Reedbed Approach',
    'Lower Rill Bridge',
  ];
  for (const destination of destinations) {
    await navigation.getByRole('button', { name: 'South', exact: true }).click();
    await expect(page.getByRole('heading', { name: destination })).toBeVisible();
  }

  await clickQuickAction(page, 'Show items to use');
  await page.getByRole('button', { name: /Use .* to fish at Lower Rill Bridge/ }).click();
  const fishing = page.getByRole('region', { name: 'Fishing in progress' });
  await expect(fishing).toBeVisible();
  await fishing.getByRole('button', { name: 'Stop' }).click();
  await expect(fishing).toBeHidden();
  await expect(page.getByRole('region', { name: 'Terminal output' }))
    .toContainText('You reel in your line and stop fishing.');
});
