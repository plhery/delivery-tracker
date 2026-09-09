import { expect, test, type Page } from '@playwright/test';
import type { ParcelWithEvents, Stage } from '../src/types';

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  failures.set(page, []);
  page.on('pageerror', error => failures.get(page)!.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

function parcel(id: string, stage: Stage, occurredAt: string, label = id): ParcelWithEvents {
  return { id, label, carrier: 'dhl', trackingNumber: `TRACK${id}`, createdAt: occurredAt,
    syncStatus: 'ok', events: [{ id: `${id}-event`, parcelId: id, stage, description: stage, occurredAt }] };
}
async function seed(page: Page, parcels: ParcelWithEvents[]) {
  await page.addInitScript(items => localStorage.setItem('sdt.demo.parcels.v1', JSON.stringify(items)), parcels);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

test('keeps the next arrival, issue notice, and search tools in one compact feed', async ({ page, isMobile }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const hero = page.getByRole('button', { name: /^Next up: New sneakers/ });
  await expect(hero).toBeVisible();
  const notice = page.locator('.parcel-card--notice');
  await expect(notice).toContainText('Birthday gift');
  await expect(notice).not.toContainText('Next up');
  const region = page.getByRole('region', { name: 'On the way' });
  await expect(region.locator('.parcel-section__heading > span')).toHaveText('6');
  const row = await page.locator('.delivery-overview').boundingBox();
  const searchButton = page.getByRole('button', { name: 'Search & filters' });
  const searchBounds = await searchButton.boundingBox();
  expect(searchBounds!.y).toBeGreaterThanOrEqual(row!.y);
  expect(searchBounds!.y + searchBounds!.height).toBeLessThanOrEqual(row!.y + row!.height + 1);
  expect(await page.locator('.deliveries-page').evaluate(el => el.clientWidth)).toBeLessThanOrEqual(660);
  if (isMobile) {
    const list = await page.locator('.parcel-section--past .parcel-grid').boundingBox();
    const card = await page.locator('.parcel-section--past .parcel-card').first().boundingBox();
    expect(card!.width).toBeGreaterThan(list!.width - 2);
  }
  await searchButton.click();
  const input = page.getByRole('searchbox', { name: 'Search parcels' });
  await expect(input).toBeFocused();
  await input.fill('birthday');
  await expect(notice).toBeVisible();
  await expect(hero).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(searchButton).toBeFocused();
  await notice.click();
  await expect(page.getByRole('dialog', { name: 'Birthday gift 🎁' })).toBeVisible();
});

test('shows the completed state with a line checkmark and newest deliveries first', async ({ page }) => {
  await seed(page, [parcel('older', 'delivered', '2026-09-07T09:00:00Z'), parcel('newer', 'delivered', '2026-09-08T09:00:00Z')]);
  await expect(page.getByRole('heading', { name: 'Everything has arrived.' })).toBeVisible();
  await expect(page.locator('.delivery-arrived > svg')).toHaveCSS('fill', 'none');
  await expect(page.locator('.parcel-section--past .parcel-card__label')).toHaveText(['newer', 'older']);
  await expect(page.locator('.parcel-card--hero')).toHaveCount(0);
  await page.getByRole('button', { name: 'Track another parcel' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a parcel' })).toBeVisible();
});

test('keeps a long undated parcel readable and a customs notice archivable', async ({ page }) => {
  const time = new Date().toISOString();
  await seed(page, [parcel('long', 'in_transit', time, 'Leather camera strap and accessories for a very long journey'), parcel('customs', 'customs', time)]);
  await expect(page.locator('.parcel-card--hero')).toBeVisible();
  await expect(page.locator('.parcel-card--hero .parcel-card__eta')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const notice = page.locator('.parcel-card--notice');
  const bounds = (await notice.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width - 15, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 15, bounds.y + bounds.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('customs archived');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(notice).toBeVisible();
});


test('does not mark returned parcels as successful arrivals', async ({ page }) => {
  await seed(page, [parcel('returned', 'returned', '2026-09-08T09:00:00Z')]);
  await expect(page.getByRole('region', { name: 'Returned' })).toBeVisible();
  await expect(page.getByText('Everything has arrived.')).toHaveCount(0);
  await expect(page.locator('.parcel-card__state > svg')).toHaveCount(0);
});
