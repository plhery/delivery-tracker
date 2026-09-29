import { expect, test, type Page } from '@playwright/test';

const preview = (page: Page) => page.getByRole('region', { name: 'Map preview' });
const direction = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Direction' }).first().getByRole('button', { name }).click();

test.beforeEach(async ({ page }) => {
  await page.goto('/design/map/open');
  await expect(page.locator('main[data-ready="true"]')).toBeVisible();
});

test('flies to a stop from the itinerary, then back to the whole trip', async ({ page }) => {
  await expect(preview(page).getByRole('region', { name: 'Itinerary' })).toBeVisible();
  const osaka = preview(page).getByRole('button', { name: /Osaka/ });
  await osaka.click();
  await expect(osaka).toHaveAttribute('aria-pressed', 'true');
  await preview(page).getByRole('button', { name: 'Whole trip' }).click();
  await expect(preview(page).getByRole('button', { name: 'Whole trip' })).toHaveCount(0);
  await expect(osaka).toHaveAttribute('aria-pressed', 'false');
});

test('replays the journey from the start to where the parcel is now', async ({ page }) => {
  await direction(page, /Replay/);
  await expect(preview(page).getByRole('slider', { name: 'Time' })).toBeVisible();
  await preview(page).getByRole('button', { name: 'Replay the journey' }).click();
  await expect(preview(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  // The whole trip plays in eight seconds and stops at the latest scan.
  await expect(preview(page).getByRole('button', { name: 'Replay the journey' })).toBeVisible({ timeout: 15_000 });
  await expect(preview(page).getByText('Departed from the hub')).toBeVisible();
});

test('prints the ends on the board, and keeps the night flight dark', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await direction(page, /Board/);
  await expect(preview(page).getByText('KYO', { exact: true })).toBeVisible();
  // A country destination prints its own code rather than three letters of its name.
  await expect(preview(page).getByText('CH', { exact: true })).toBeVisible();
  await direction(page, /Night flight/);
  await expect(preview(page).locator('[data-theme="dark"]')).toBeVisible();
  await expect(preview(page).getByText('Kyoto tea set 🍵')).toBeVisible();
  await direction(page, /Today/);
  await expect(preview(page).getByText('From', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
