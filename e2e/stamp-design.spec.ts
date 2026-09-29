import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/design/stamp');
  await expect(page.locator('main[data-ready="true"]')).toBeVisible();
});

test('shows each direction on the opened card and in the list', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const light = page.getByRole('region', { name: 'Cards' }).locator('[data-theme=light]');
  const opened = light.locator('.detail--postcard');
  const nextUp = light.locator('.parcel-card--hero');
  const direction = (name: string) => page.getByRole('group', { name: 'Direction' }).getByRole('button', { name: new RegExp(`^\\d+ ${name}`) });

  await expect(opened.first().locator('[data-mark=recut]')).toBeVisible();
  await expect(nextUp.first().locator('[data-mark=recut]')).toBeVisible();

  await direction('Postmark').click();
  // The postmark names the last scanned town: Zürich for the sneakers out for delivery.
  await expect(opened.first().locator('[data-mark=postmark]')).toContainText('ZÜRICH');
  await expect(opened.nth(2).locator('[data-mark=postmark]')).toContainText('QUICKPAC');

  await direction('Today').click();
  await expect(opened.first().locator('.postage-stamp')).toBeVisible();

  await direction('None').click();
  await expect(light.locator('[data-mark], .detail__title-row .postage-stamp, .parcel-card__hero-main .postage-stamp')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('can leave the mark out beside a map', async ({ page }) => {
  const opened = page.getByRole('region', { name: 'Cards' }).locator('[data-theme=light] .detail--postcard');
  await page.getByRole('checkbox', { name: 'Leave it out when the opened card shows a map' }).check();
  await expect(opened.first().locator('.detail__engraving')).toHaveCount(1);
  await expect(opened.first().locator('[data-mark]')).toHaveCount(0);
  // A parcel with no places yet has no map, so it keeps its stamp.
  await expect(opened.nth(2).locator('[data-mark=recut]')).toBeVisible();
});
