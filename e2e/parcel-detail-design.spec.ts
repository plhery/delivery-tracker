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
