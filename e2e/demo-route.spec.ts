import { expect, test, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const frontDoor = (page: Page) => page.getByRole('heading', { name: 'Where’s my parcel?' });
const path = (page: Page) => { const url = new URL(page.url()); return url.pathname + url.search; };

test('opens the demo at its own address, keeps it there across a reload, and leaves it for the front door', async ({ page, request }) => {
  // The page arrives as the demo: nothing of the front door is painted first.
  const html = await (await request.get('/demo')).text();
  expect(html).toContain('demo-banner');
  expect(html).not.toMatch(/<h1[^>]*>Where’s my parcel\?/);

  await page.goto('/demo');
  await expect(page.getByText('Coffee beans ☕', { exact: true })).toBeVisible();
  await expect(page.locator('.demo-banner')).toBeVisible();
  expect(path(page)).toBe('/demo');

  // The demo works at its address as it does at `/`: a parcel and a tab are part of it.
  await page.getByText('Coffee beans ☕', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Coffee beans ☕' })).toBeVisible();
  expect(path(page)).toMatch(/^\/demo\?parcel=/);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Coffee beans ☕' })).toBeVisible();
  expect(path(page)).toMatch(/^\/demo\?parcel=/);

  await page.getByRole('dialog', { name: 'Coffee beans ☕' }).getByRole('button', { name: 'Exit demo' }).click();
  await expect(frontDoor(page)).toBeVisible();
  expect(path(page)).toBe('/');
  await page.reload();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
});

test('shows the demo at its address without changing what `/` opens', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.locator('.demo-banner')).toBeVisible();
  // Nothing is remembered for the address: the front door is still what `/` opens.
  await page.goto('/');
  await expect(frontDoor(page)).toBeVisible();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  // The demo is at its address again, and Back returns to the front door.
  await page.goto('/demo');
  await expect(page.getByText('Coffee beans ☕', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(frontDoor(page)).toBeVisible();
  expect(path(page)).toBe('/');
});
