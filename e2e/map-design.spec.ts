import { expect, test, type Page } from '@playwright/test';

const preview = (page: Page) => page.getByRole('region', { name: 'Parcel preview' });
const map = (page: Page) => preview(page).locator('[data-scale]').first();

test.beforeEach(async ({ page }) => {
  await page.goto('/design/map');
  await expect(page.locator('main[data-ready="true"]')).toBeVisible();
  await expect(map(page)).toBeVisible();
});

test('follows a far journey into a close-up and back out once delivered', async ({ page }) => {
  await expect(map(page)).toHaveAttribute('data-scale', 'world');
  await expect(map(page)).toHaveAttribute('data-mode', 'journey');

  const scan = page.getByRole('slider', { name: 'Scan' });
  await scan.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('Out for delivery', { exact: true }).first()).toBeVisible();
  await expect(map(page)).toHaveAttribute('data-mode', 'now');
  // The origin stays on the edge of the close-up, with its distance.
  await expect(preview(page).getByText(/^Kyoto 9,500 km$/)).toBeVisible();

  await preview(page).getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(map(page)).toHaveAttribute('data-mode', 'journey');
  await scan.focus();
  await page.keyboard.press('End');
  await expect(map(page)).toHaveAttribute('data-mode', 'journey');
  await expect(preview(page).getByText('Delivered', { exact: true }).first()).toBeVisible();
});

test('keeps near journeys close and sparse ones honest', async ({ page }) => {
  await page.getByRole('button', { name: 'Close to home', exact: true }).click();
  await expect(map(page)).toHaveAttribute('data-scale', 'local');
  await expect(preview(page).getByRole('group', { name: 'Map view' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Countries only', exact: true }).click();
  await expect(map(page)).toHaveAttribute('data-scale', 'world');
  await expect(preview(page).getByText('Last seen', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'No places', exact: true }).click();
  await expect(map(page)).toHaveAttribute('data-scale', 'none');
  await expect(preview(page).getByText('No places yet.')).toBeVisible();
});

test('opens the card’s engraved route as a full map', async ({ page }) => {
  await page.getByRole('button', { name: /^02 Card/ }).click();
  await preview(page).getByRole('button', { name: 'Open the map' }).click();
  await expect(preview(page).getByRole('button', { name: 'Close the map' })).toBeVisible();
  await expect(preview(page).getByText('From', { exact: true })).toBeVisible();
  await preview(page).getByRole('button', { name: 'Close the map' }).click();
  await expect(preview(page).getByRole('button', { name: 'Close the map' })).toHaveCount(0);
});

test('fits every direction on a phone in the dark preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(preview(page).locator('[data-theme="dark"]').first()).toBeVisible();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const direction of [/^01 Deck/, /^02 Card/, /^03 Lens/]) {
      await page.getByRole('button', { name: direction }).click();
      for (const [journey, parcel] of [['Across the world', 'Kyoto tea set'], ['Across the border', 'Linen shirt'],
        ['Close to home', 'Coffee beans'], ['No places', '35mm film rolls']]) {
        await page.getByRole('button', { name: journey, exact: true }).click();
        await expect(preview(page).getByRole('heading', { name: new RegExp(`^${parcel}`) })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  expect(errors).toEqual([]);
});
