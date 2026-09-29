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

test('zooms the full map with the wheel, and returns to the parcel', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Wheels and trackpads are for desktops.');
  await page.getByRole('button', { name: /^(?:Next up: )?New sneakers 👟 —/ }).click();
  await page.locator('.detail--postcard').getByRole('button', { name: 'Open the map' }).click();
  const map = page.getByRole('dialog', { name: /^Map of the journey/ });
  const nearby = map.getByRole('button', { name: 'Nearby' });
  await expect(nearby).toHaveAttribute('aria-pressed', 'true');
  const box = (await map.locator('[data-scale]').boundingBox())!;
  await page.mouse.move(box.x + box.width * .6, box.y + box.height / 3);
  await page.mouse.wheel(0, -400);
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');
  await nearby.click();
  await expect(nearby).toHaveAttribute('aria-pressed', 'true');
});

test('pinches the full map, and lets the card peek closer', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile || browserName !== 'chromium', 'Two-finger touches go through Chromium’s DevTools protocol.');
  const client = await page.context().newCDPSession(page);
  const pinch = async (x: number, y: number, from: number, to: number, lift = true) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - from, y, id: 1 }, { x: x + from, y, id: 2 }] });
    for (let step = 1; step <= 6; step += 1) {
      const spread = from + (to - from) * step / 6;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - spread, y, id: 1 }, { x: x + spread, y, id: 2 }] });
    }
    if (lift) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await page.getByRole('button', { name: /^(?:Next up: )?New sneakers 👟 —/ }).click();
  const detail = page.locator('.detail--postcard');
  const engraving = detail.locator('.detail__engraving');
  const leg = engraving.locator('path[data-kind="travelled"]').first();
  await expect(leg).toBeAttached();
  const resting = await leg.getAttribute('d');
  const card = (await engraving.boundingBox())!;
  await pinch(card.x + card.width / 2, card.y + card.height / 2, 30, 90, false);
  await expect.poll(() => leg.getAttribute('d')).not.toBe(resting);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Lifting the fingers settles the card back without opening the map.
  await expect.poll(() => leg.getAttribute('d')).toBe(resting);
  await expect(page.getByRole('dialog', { name: /^Map of the journey/ })).toHaveCount(0);

  await detail.getByRole('button', { name: 'Open the map' }).click();
  const map = page.getByRole('dialog', { name: /^Map of the journey/ });
  const nearby = map.getByRole('button', { name: 'Nearby' });
  await expect(nearby).toHaveAttribute('aria-pressed', 'true');
  const box = (await map.locator('[data-scale]').boundingBox())!;
  await pinch(box.x + box.width / 2, box.y + box.height / 3, 80, 20);
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');
  await expect(map).toBeVisible();
});

test('keeps the card plain for a parcel with no places yet', async ({ page }) => {
  await page.getByRole('button', { name: /^(?:Next up: )?35mm film rolls 🎞️ —/ }).click();
  const detail = page.locator('.detail--postcard');
  await expect(detail.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(detail.locator('.detail__engraving')).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Open the map' })).toHaveCount(0);
});
