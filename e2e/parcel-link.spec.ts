import { expect, test, type Page } from '@playwright/test';

// The demo build keeps lookups in the browser; every number here is fictional.
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const frontDoor = (page: Page) => page.getByRole('heading', { name: 'Where’s my parcel?' });
const parcelAddress = /\/p\/[2-9A-HJ-NP-Za-km-z]{12}$/;

async function track(page: Page, text: string) {
  await page.goto('/');
  await expect(frontDoor(page)).toBeVisible();
  const submit = page.getByRole('button', { name: 'Track', exact: true });
  await expect(submit).toBeEnabled();
  await page.getByRole('textbox', { name: 'Tracking number or link' }).fill(text);
  await submit.click();
  await expect(page).toHaveURL(parcelAddress);
}

test('follows one parcel without an account: a number typed at the door gets its own page, which a reload keeps', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (request) => sent.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`));
  await track(page, '1ZDEMO202600000009');
  // The page opens with the lookup's answer, then the first check lands.
  await expect(page.locator('main')).toHaveAttribute('data-entrance', 'reveal');
  await expect(page.getByLabel('UPS', { exact: true })).toBeVisible();
  await expect(page.getByText('1ZDEMO202600000009', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
  // Pip wears the carrier's label.
  await expect(page.locator('.parcel-illustration__label-name')).toHaveText('ups');
  const address = page.url();

  await page.reload();
  await expect(page).toHaveURL(address);
  await expect(page.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-entrance', 'direct');
  await expect(page.getByText('1ZDEMO202600000009', { exact: true }).first()).toBeVisible();
  // The demo asks no server about the parcel, and its number never leaves the browser.
  expect(sent.filter((entry) => entry.includes('/api/public/') || entry.includes('1ZDEMO202600000009'))).toEqual([]);
});

test('goes back to the front door, lists the parcel on this device, and forward to its page again', async ({ page }) => {
  await track(page, 'DEMOGLS20260009');
  await expect(page.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
  const address = page.url();
  await page.goBack();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const recent = page.getByRole('region', { name: 'On this device' }).getByRole('link');
  await expect(recent).toHaveCount(1);
  await expect(recent).toContainText('In transit');
  await page.goForward();
  await expect(page).toHaveURL(address);
  await expect(page.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
  await page.goBack();
  await expect(frontDoor(page)).toBeVisible();
  await recent.click();
  await expect(page).toHaveURL(address);
  // The name leads back to the door.
  await page.locator('.peekp-home').click();
  await expect(frontDoor(page)).toBeVisible();
});

test('a manual check moves the fictional parcel on, down to delivery', async ({ page }) => {
  await track(page, '1ZDEMO202600000009');
  const status = page.getByRole('heading', { level: 1 });
  await expect(status).toHaveText('In transit');
  const check = page.getByRole('button', { name: 'Check now', exact: true });
  await check.click();
  await expect(status).toHaveText('Out for delivery');
  await check.click();
  await expect(status).toHaveText('Delivered');
});

test('shows the same unavailable page for a link that was never made and for a malformed one', async ({ page }) => {
  for (const id of ['k7Qm2xHd9RtW', 'not-a-link']) {
    const response = await page.goto(`/p/${id}`);
    expect(response!.status()).toBe(200);
    expect(response!.headers()['referrer-policy']).toBe('no-referrer');
    expect(response!.headers()['x-robots-tag']).toContain('noindex');
    await expect(page.getByRole('heading', { level: 1, name: 'This parcel has been forgotten' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Where’s my parcel?', exact: true }).click();
  await expect(frontDoor(page)).toBeVisible();
});

test('fits a phone at 320 px, in German and in the dark', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('deliveryTrackerLocale', 'de'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wo ist mein Paket?' })).toBeVisible();
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await fits()).toBe(true);
  const submit = page.getByRole('button', { name: 'Verfolgen', exact: true });
  await expect(submit).toBeEnabled();
  await page.getByRole('textbox').fill('1ZDEMO202600000009');
  await submit.click();
  await expect(page).toHaveURL(parcelAddress);
  await expect(page.getByRole('heading', { level: 1, name: 'Unterwegs' })).toBeVisible();
  expect(await fits()).toBe(true);
});

// The page stream adds the "keep it" action to the parcel page; the wiring behind it is in place and unit-tested.
test.fixme('keeps the parcel after "Sign in to keep it": Explore the demo brings it into the demo deliveries and forgets the device copy', async ({ page }) => {
  await track(page, '1ZDEMO202600000009');
  await page.getByRole('button', { name: 'Sign in to add it to your deliveries' }).click();
  await page.getByRole('button', { name: 'Explore the demo' }).click();
  await expect(page.getByText('Added to your deliveries')).toBeVisible();
  await expect(page.getByRole('button', { name: /1ZDEMO202600000009/ })).toBeVisible();
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'On this device' })).toHaveCount(0);
});
