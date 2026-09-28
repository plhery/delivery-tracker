import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    localStorage.setItem('deliveryTrackerLocale', 'en');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('engraves the route in the card and opens it as a full map', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: /^(?:Next up: )?New sneakers 👟 —/ }).click();
  const detail = page.locator('.detail--postcard');
  const engraving = detail.locator('.detail__engraving [data-scale]');
  // Out for delivery: the card shows the last mile, with Hamburg on the edge.
  await expect(engraving).toHaveAttribute('data-mode', 'now');
  await expect(detail.locator('.detail__engraving').getByText('Hamburg', { exact: true })).toBeVisible();

  const open = detail.getByRole('button', { name: 'Open the map' });
  await open.click();
  const map = page.getByRole('dialog', { name: 'Map of the journey from Hamburg to Zürich' });
  await expect(map).toBeVisible();
  await expect(map.getByText('From', { exact: true })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Nearby' })).toHaveAttribute('aria-pressed', 'true');
  await map.getByRole('button', { name: 'Journey' }).click();
  await expect(map.locator('[data-scale]')).toHaveAttribute('data-mode', 'journey');
  const bar = (await map.locator('.parcel-map__bar').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bar.x + bar.width).toBeLessThanOrEqual(viewport.width);
  expect(bar.y + bar.height).toBeLessThanOrEqual(viewport.height);

  await page.keyboard.press('Escape');
  await expect(map).toHaveCount(0);
  await expect(detail).toBeVisible();
  await expect(open).toBeFocused();
  expect(errors).toEqual([]);
});

test('keeps the card plain for a parcel with no places yet', async ({ page }) => {
  await page.getByRole('button', { name: /^(?:Next up: )?35mm film rolls 🎞️ —/ }).click();
  const detail = page.locator('.detail--postcard');
  await expect(detail.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(detail.locator('.detail__engraving')).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Open the map' })).toHaveCount(0);
});
