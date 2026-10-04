import { expect, test, type Page } from '@playwright/test';

// The sample parcel is told by the browser: every number here is fictional.
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const frontDoor = (page: Page) => page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' });
const status = (page: Page) => page.getByRole('heading', { level: 1 });
const note = (page: Page) => page.getByText('Sample parcel', { exact: true });
const path = (page: Page) => new URL(page.url()).pathname;
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('shows one parcel as a pasted number would, says it is a sample, and keeps nothing of it', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/public/')) sent.push(`${request.method()} ${request.url()}`); });
  await page.goto('/sample');
  await expect(note(page)).toBeVisible();
  await expect(status(page)).toHaveText('In transit');
  await expect(page.locator('.peekp-card__name')).toHaveText('Moon lamp 🌙');
  await expect(page.getByLabel('GLS Germany', { exact: true })).toBeVisible();
  await expect(page.getByText('DEMOGLS20260001', { exact: true }).first()).toBeVisible();
  await expect(page).toHaveTitle(/^Moon lamp 🌙 · In transit/);
  // A sample is not a parcel of this device: it is neither forgotten nor kept.
  await expect(page.getByText('Peek forgets this parcel 30 days after delivery.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Forget it now' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in to keep it' })).toHaveCount(0);

  // A check moves its story on, as a scan arriving would.
  await page.getByRole('button', { name: /Check now$/ }).click();
  await expect(status(page)).toHaveText('Out for delivery');
  await page.getByRole('button', { name: /Check now$/ }).click();
  await expect(status(page)).toHaveText('Delivered');
  // A name lasts as long as the page.
  await page.getByRole('button', { name: 'Edit parcel name' }).click();
  await page.getByRole('textbox', { name: 'Parcel name' }).fill('Night light');
  await page.keyboard.press('Enter');
  await expect(page.locator('.peekp-card__name')).toHaveText('Night light');

  // A reload tells the story from its beginning.
  await page.reload();
  await expect(status(page)).toHaveText('In transit');
  await expect(page.locator('.peekp-card__name')).toHaveText('Moon lamp 🌙');
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('sdt.peek.')))).toEqual([]);
  expect(sent).toEqual([]);

  // A link's address never shows the sample.
  await page.goto('/p/sample');
  await expect(status(page)).toHaveText('This parcel has been forgotten');
});

test('leads to a parcel of one’s own, to signing in and to the demo deliveries', async ({ page }) => {
  await page.goto('/sample');
  await expect(note(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Waiting for a real one?' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Following more than one?' })).toBeVisible();

  const demo = page.getByRole('link', { name: 'Try the demo' });
  await expect(demo).toHaveAttribute('href', '/demo');
  await demo.click();
  await expect(page.locator('.demo-banner')).toBeVisible();
  expect(path(page)).toBe('/demo');
  await page.goBack();
  await expect(note(page)).toBeVisible();
  expect(path(page)).toBe('/sample');

  await page.getByRole('button', { name: 'Track your parcel' }).click();
  await expect(frontDoor(page)).toBeVisible();
  expect(path(page)).toBe('/');
  // The landing is still a first visit's: the sample left no parcel on this device.
  await expect(page.locator('.door')).toHaveAttribute('data-view', 'first');
  await page.goBack();
  await expect(note(page)).toBeVisible();

  // The way back to the landing stands above the card.
  const homePage = page.getByRole('link', { name: 'Home page' });
  await expect(homePage).toHaveAttribute('href', '/');
  await homePage.click();
  await expect(frontDoor(page)).toBeVisible();
  expect(path(page)).toBe('/');
  await page.goBack();
  await expect(note(page)).toBeVisible();

  await page.locator('.peekp-keep').getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.arrival')).toBeVisible();
});

test('fits a phone at 320 px, in German and in the dark', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('deliveryTrackerLocale', 'de'));
  await page.goto('/sample');
  await expect(page.getByText('Beispielpaket', { exact: true })).toBeVisible();
  // The sample's own words are in the reader's language too.
  await expect(page.locator('.peekp-card__name')).toHaveText('Mondlampe 🌙');
  await expect(page.getByText('Hat das Sortierzentrum verlassen. Vollmond in Kürze erwartet.')).toBeVisible();
  expect(await fits(page)).toBe(true);
  await page.getByRole('button', { name: /Jetzt prüfen$/ }).click();
  await page.getByRole('button', { name: /Jetzt prüfen$/ }).click();
  await expect(status(page)).toHaveText('Zugestellt');
  expect(await fits(page)).toBe(true);
});
