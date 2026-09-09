import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    localStorage.setItem('deliveryTrackerLocale', 'en');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^(?:Next up: )?New sneakers 👟 —/ }).click();
});

test('keeps tracking actions available when history is folded and preserves title editing', async ({ page }) => {
  const detail = page.locator('.detail--postcard');
  const journal = detail.locator('.tracking-journal');
  await expect(journal).toHaveAttribute('open', '');
  const eventCount = await journal.locator('time').count();
  expect(eventCount).toBeGreaterThan(3);
  await journal.locator('summary').click();
  await expect(journal).not.toHaveAttribute('open', '');
  await expect(detail.getByRole('button', { name: 'Copy tracking number', exact: true })).toBeVisible();
  const carrierLink = detail.locator('.detail__carrier-link').first();
  await expect(carrierLink).toBeVisible();
  await expect(carrierLink).toHaveAttribute('href', /^https:\/\//);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.copiedTracking = text; },
    } });
  });
  await detail.getByRole('button', { name: 'Copy tracking number', exact: true }).click();
  await expect(detail.locator('[aria-live="polite"]')).toContainText('Copied');
  await expect(journal).not.toHaveAttribute('open', '');
  const displayedNumber = (await detail.locator('.detail__tracking-ticket strong').textContent())!.replace(/[.\s]/g, '');
  expect((await page.locator('html').getAttribute('data-copied-tracking'))!.replace(/[.\s]/g, '')).toBe(displayedNumber);
  await journal.locator('summary').click();
  await expect(journal.locator('time')).toHaveCount(eventCount);
  await detail.getByLabel('Parcel actions', { exact: true }).click();
  await detail.getByRole('button', { name: 'Edit parcel title' }).click();
  await detail.getByRole('textbox').fill('New sneakers for the autumn marathon and weekend walks');
  await detail.getByRole('button', { name: 'Save title' }).click();
  await expect(detail.getByRole('heading', { level: 1 })).toContainText('autumn marathon');
  expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(detail.locator('.detail__state')).toHaveCSS('font-weight', '400');
});

test('closes from the backdrop, but keeps inside clicks and nested dialogs open', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const detail = page.locator('.detail--postcard');
  await expect(detail).toBeVisible();
  await detail.getByRole('heading', { level: 1 }).click();
  await expect(detail).toBeVisible();

  // Releasing a drag outside the card must not dismiss it.
  const bounds = (await detail.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(20, 180);
  await page.mouse.up();
  await expect(detail).toBeVisible();

  await detail.getByRole('button', { name: /Change carrier from/ }).click();
  const carrier = page.getByRole('dialog', { name: 'Change carrier', exact: true });
  await expect(carrier).toBeVisible();
  await page.mouse.click(20, 180);
  await expect(carrier).toHaveCount(0);
  await expect(detail).toBeVisible();

  await page.mouse.click(20, 180);
  await expect(detail).toHaveCount(0);
  await expect(page.locator('.detail-backdrop')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(?:Next up: )?New sneakers 👟 —/ })).toBeFocused();
});
