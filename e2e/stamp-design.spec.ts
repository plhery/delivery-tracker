import { expect, test, type Page } from '@playwright/test';

const light = (page: Page) => page.getByRole('region', { name: 'Cards' }).locator('[data-theme=light]');
const opened = (page: Page) => light(page).locator('.detail--postcard');
const pick = (page: Page, group: string, name: string) => page.getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: true }).click();

test.beforeEach(async ({ page }) => {
  await page.goto('/design/stamp');
  await expect(page.locator('main[data-ready="true"]')).toBeVisible();
});

test('draws every motif, and postmarks only delivered parcels', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // One row per motif, one stamp per sample parcel.
  await expect(page.getByRole('region', { name: 'Stamp sheet' }).locator('[data-theme=light] [data-mark=globe]')).toHaveCount(5);
  // The sneakers are still on their way; the matcha has arrived and carries the date it did.
  await expect(opened(page).first().locator('[data-mark=globe]')).toBeVisible();
  await expect(opened(page).first().locator('[data-mark]')).not.toContainText(/\d{2}\.\d{2}/);
  await expect(opened(page).nth(1).locator('[data-mark]')).toContainText(/\d{2}\.\d{2}/);

  await pick(page, 'Motif', 'Letters');
  await expect(opened(page).first().locator('[data-mark=letters]')).toContainText('DE');
  await pick(page, 'Print', 'Engraved');
  await expect(opened(page).first().locator('[data-print=engraved]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('puts the stamp on four kinds of card', async ({ page }) => {
  const card = (name: string) => page.getByRole('group', { name: 'Card' }).getByRole('button', { name: new RegExp(name) });
  await card('Envelope').click();
  // The stamp moves up into the corner beside the carrier.
  await expect(opened(page).first().locator('.detail__hero-meta [data-mark]')).toBeVisible();

  await card('Postcard').click();
  // The carrier's latest words become the message, and the route waits behind the globe.
  await expect(opened(page).first()).toContainText('With the courier for delivery today');
  await expect(opened(page).first().locator('.detail__engraving')).toHaveCount(0);

  await card('Stamp card').click();
  await expect(opened(page).first().locator('.detail__engraving')).toHaveCount(1);
  await expect(light(page).locator('[data-design=stamp] svg path').first()).toBeAttached();
});

test('can leave the stamp out beside a map', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Leave the stamp out when the opened card shows a map' }).check();
  await expect(opened(page).first().locator('.detail__engraving')).toHaveCount(1);
  await expect(opened(page).first().locator('[data-mark]')).toHaveCount(0);
  // A parcel with no places yet has no map, so it keeps its stamp.
  await expect(opened(page).nth(2).locator('[data-mark]')).toBeVisible();
});
