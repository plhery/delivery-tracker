import { expect, test, type Page } from '@playwright/test';
import { allowCopying, copied, fits, track } from './peek';

// The demo build keeps lookups in the browser; every number here is fictional.
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const frontDoor = (page: Page) => page.getByRole('heading', { name: 'Where’s my parcel?' });
const status = (page: Page) => page.getByRole('heading', { level: 1 });

test('follows one parcel without an account: a number typed at the door gets its own page, which a reload keeps', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (request) => sent.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`));
  await track(page, '1ZDEMO202600000092');
  // The page opens with the lookup's answer, then the first check lands and the status is the headline.
  await expect(page.locator('.peekp-main')).toHaveAttribute('data-entrance', 'reveal');
  // The page lies over the door, which lists the parcel too.
  await expect(page.locator('.peekp').getByLabel('UPS', { exact: true })).toBeVisible();
  await expect(page.locator('.peekp').getByText('1ZDEMO202600000092', { exact: true }).first()).toBeVisible();
  await expect(status(page)).toHaveText('In transit');
  await expect(page).toHaveTitle(/^In transit · /);
  // The reveal ends by offering the parcel's own link.
  await expect(page.getByText('This parcel has its own link')).toBeVisible();
  const address = page.url();

  await page.reload();
  await expect(page).toHaveURL(address);
  await expect(status(page)).toHaveText('In transit');
  await expect(page.locator('main')).toHaveAttribute('data-entrance', 'direct');
  await expect(page.getByText('This parcel has its own link')).toHaveCount(0);
  await expect(page.getByText('1ZDEMO202600000092', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Peek forgets this parcel 30 days after delivery.')).toBeVisible();
  // Pip and the map are drawings: assistive tech gets the status, the carrier and the journal instead.
  await expect(page.locator('.peekp-card [aria-hidden=true]').first()).toBeAttached();
  // The demo asks no server about the parcel, and its number never leaves the browser.
  expect(sent.filter((entry) => entry.includes('/api/public/') || entry.includes('1ZDEMO202600000092'))).toEqual([]);
});

test('goes back to the front door, lists the parcel on this device, and forward to its page again', async ({ page }) => {
  await track(page, 'DEMOGLS20260009');
  await expect(status(page)).toHaveText('In transit');
  const address = page.url();
  await page.goBack();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const recent = page.getByRole('region', { name: 'On this device' }).getByRole('link');
  await expect(recent).toHaveCount(1);
  await expect(recent).toContainText('In transit');
  await page.goForward();
  await expect(page).toHaveURL(address);
  await expect(status(page)).toHaveText('In transit');
  await page.goBack();
  await expect(frontDoor(page)).toBeVisible();
  await recent.click();
  await expect(page).toHaveURL(address);
  // The name leads back to the door, and so does "Track another parcel": the page closes, to the door's own step
  // in the history.
  await page.locator('.peekp-home').click();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await page.getByRole('button', { name: 'Track another parcel' }).click();
  await expect(frontDoor(page)).toBeVisible();
});

test('a manual check moves the fictional parcel on, down to delivery, where the box opens and the forget date appears', async ({ page }) => {
  await track(page, '1ZDEMO202600000092');
  await expect(status(page)).toHaveText('In transit');
  const check = page.getByRole('button', { name: /Check now$/ });
  await check.click();
  await expect(status(page)).toHaveText('Out for delivery');
  // A scan that arrives while the page is open is told, in the page and in the tab.
  await expect(page.getByText('New update')).toBeVisible();
  await expect(page).toHaveTitle(/^Out for delivery · /);
  await check.click();
  await expect(status(page)).toHaveText('Delivered');
  await expect(page).toHaveTitle(/^Delivered at \d\d:\d\d · Peek$/);
  await expect(page.locator('.peekp-card__detail')).toHaveText(/^Today, \d\d:\d\d$/);
  await expect(page.getByText(/^Peek forgets this parcel on \d+ \p{L}+\.$/u)).toBeVisible();
  // The journey is over: nothing is left to check.
  await expect(check).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Step 6 of 6: Delivered' })).toBeVisible();
});

test('names the parcel on this device: the page, a reload and the front door show the name', async ({ page }) => {
  await track(page, 'DEMOGLS20260009');
  await page.getByRole('button', { name: 'Name it' }).click();
  await expect(page.getByRole('textbox', { name: 'Parcel name' })).toBeFocused();
  await page.keyboard.type('Moon lamp');
  await page.keyboard.press('Enter');
  await expect(page.locator('.peekp-card__name')).toHaveText('Moon lamp');
  await expect(status(page)).toHaveText('In transit');
  await expect(page).toHaveTitle(/^Moon lamp · In transit/);
  await page.reload();
  await expect(page.locator('.peekp-card__name')).toHaveText('Moon lamp');
  await page.locator('.peekp-home').click();
  await expect(page.getByRole('region', { name: 'On this device' }).getByRole('link')).toContainText('Moon lamp');
});

test('shares the link by copying it where there is no share sheet, and the name only when asked', async ({ page }) => {
  await allowCopying(page);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  await track(page, 'DEMOGLS20260009');
  await page.getByRole('button', { name: 'Name it' }).click();
  await page.keyboard.type('A surprise');
  await page.keyboard.press('Enter');
  // The owner's Share opens the sheet; its "Share…" copies where the system has no share sheet.
  await page.locator('.peekp-actions').getByRole('button', { name: 'Share', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Share this parcel' });
  await sheet.getByRole('button', { name: 'Share…' }).click();
  await expect(sheet.getByText('Link copied')).toBeVisible();
  expect(await copied(page)).toBe(page.url());
  expect(page.url()).not.toContain('surprise');
  // The name travels only once it is switched on, and then after the #.
  await sheet.getByRole('switch', { name: 'Show its name' }).check();
  await sheet.getByRole('button', { name: 'Copy' }).click();
  await expect.poll(() => copied(page)).toBe(`${page.url()}#n=A%20surprise`);
});

test('forgets the parcel after asking once, and its link then leads nowhere', async ({ page }) => {
  await track(page, 'DEMOGLS20260009');
  await expect(status(page)).toHaveText('In transit');
  const address = page.url();
  await page.getByRole('button', { name: 'Forget it now' }).click();
  const dialog = page.getByRole('dialog', { name: 'Forget this parcel?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Forget it now' }).click();
  await dialog.getByRole('button', { name: 'Forget it now' }).click();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page.getByText('Parcel forgotten')).toBeVisible();
  await expect(page.getByRole('region', { name: 'On this device' })).toHaveCount(0);
  await page.goto(address);
  await expect(page.getByRole('heading', { level: 1, name: 'This parcel has been forgotten' })).toBeVisible();
});

test('shows the same unavailable page for a link that was never made and for a malformed one', async ({ page }) => {
  for (const id of ['k7Qm2xHd9RtW', 'not-a-link']) {
    const response = await page.goto(`/p/${id}`);
    expect(response!.status()).toBe(200);
    expect(response!.headers()['referrer-policy']).toBe('no-referrer');
    expect(response!.headers()['x-robots-tag']).toContain('noindex');
    await expect(page.getByRole('heading', { level: 1, name: 'This parcel has been forgotten' })).toBeVisible();
    await expect(page.getByText('A link that never existed shows the same page, so links can’t be guessed.')).toBeVisible();
    await expect(page).toHaveTitle('This parcel has been forgotten · Peek');
    // Its preview is Peek's own, and never indexed.
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Peek — Universal Parcel Tracker');
    expect(await fits(page)).toBe(true);
  }
  await page.getByRole('button', { name: 'Where’s my parcel?', exact: true }).click();
  await expect(frontDoor(page)).toBeVisible();
});

test('serves Peek’s own preview image for a link that leads nowhere', async ({ request }) => {
  for (const id of ['k7Qm2xHd9RtW', 'unavailable']) {
    const response = await request.get(`/api/public/parcels/${id}/image?lang=de`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(response.headers()['x-robots-tag']).toContain('noindex');
  }
});

test('fits a phone at 320 px, in German and in the dark', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('deliveryTrackerLocale', 'de'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wo ist mein Paket?' })).toBeVisible();
  expect(await fits(page)).toBe(true);
  // A sample with places on its way: the map runs across the card.
  await track(page, '1234567899', { field: 'Sendungsnummer oder Link', track: 'Verfolgen' });
  await expect(status(page)).toHaveText('Abholbereit');
  expect(await fits(page)).toBe(true);
  // The name form, the forget dialog and a delivered parcel fit as well.
  await page.getByRole('button', { name: 'Benennen' }).click();
  expect(await fits(page)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Jetzt vergessen' }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  expect(await fits(page)).toBe(true);
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByRole('button', { name: /Jetzt prüfen$/ }).click();
  await expect(status(page)).toHaveText('Zugestellt');
  expect(await fits(page)).toBe(true);
});

test('shows still frames under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await track(page, '1ZDEMO202600000092');
  await expect(status(page)).toHaveText('In transit');
  const running = () => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running'
    && Number(animation.effect?.getComputedTiming().duration) > 1).length);
  expect(await running()).toBe(0);
  const check = page.getByRole('button', { name: /Check now$/ });
  await check.click();
  await check.click();
  await expect(status(page)).toHaveText('Delivered');
  expect(await running()).toBe(0);
});

test('keeps the parcel after “Create an account”: the demo takes it with its name and history, then offers the device’s other parcels', async ({ page }) => {
  // Two parcels looked up on this device; the first gets a name.
  await track(page, '1ZDEMO202600000092');
  await page.getByRole('button', { name: 'Name it' }).click();
  await page.keyboard.type('Kind of Blue');
  await page.keyboard.press('Enter');
  const first = page.url();
  await track(page, 'DEMOGLS20260009');
  await expect(status(page)).toHaveText('In transit');

  // Back on the first one's own link, after a reload: keep it.
  await page.goto(first);
  await expect(page.locator('.peekp-card__name')).toHaveText('Kind of Blue');
  await page.getByRole('button', { name: /^All your parcels in one place/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Explore the demo' }).click();
  await expect(page.getByText('Kept · alerts are on')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Kind of Blue — In transit/ })).toBeVisible();

  // The other parcel of this device is offered once.
  const sheet = page.getByRole('dialog', { name: 'Bring these parcels too?' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('checkbox')).toHaveCount(1);
  await expect(sheet).toContainText('DEMOGLS…0009');
  await sheet.getByRole('button', { name: 'Add 1 parcel' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('1 parcel added to your deliveries')).toBeVisible();

  // Both are in the deliveries now, and no longer on the device: their links lead nowhere.
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page.getByRole('region', { name: 'On this device' })).toHaveCount(0);
  await page.goto(first);
  await expect(page.getByRole('heading', { level: 1, name: 'This parcel has been forgotten' })).toBeVisible();
});

test('lists the device’s other parcels at the foot of a page, and opens one on its card', async ({ page }) => {
  await track(page, 'DEMOGLS20260009');
  const first = page.url();
  // Nothing else on this device, and the parcel is on its way: the page ends with its journey.
  await expect(page.getByRole('region', { name: 'Also on this device' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Waiting for something else?' })).toHaveCount(0);
  await track(page, '1ZDEMO202600000092');
  await expect(status(page)).toHaveText('In transit');
  const check = page.getByRole('button', { name: /Check now$/ });
  await check.click();
  await expect(status(page)).toHaveText('Out for delivery');
  await check.click();
  await expect(status(page)).toHaveText('Delivered');
  // The day Peek forgets the parcel is a line of the footer, not a card.
  await expect(page.locator('footer').getByText(/^Peek forgets this parcel on \d+ \p{L}+\.$/u)).toBeVisible();
  await expect(page.locator('footer').getByRole('button', { name: 'Forget it now' })).toBeVisible();

  const others = page.getByRole('region', { name: 'Also on this device' });
  await expect(others.getByRole('link')).toHaveCount(1);
  await expect(others.getByRole('link')).toContainText('DEMOGLS…0009');
  await expect(others.getByRole('link')).toContainText('In transit');
  await expect(others.getByText('Kept in this browser only.')).toBeVisible();
  await expect(others.getByRole('button', { name: 'Create an account to keep them, with alerts' })).toBeVisible();
  await others.getByRole('link').click();
  await expect(page).toHaveURL(first);
  await expect(status(page)).toHaveText('In transit');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  // Back returns to the parcel the list was on.
  await page.goBack();
  await expect(status(page)).toHaveText('Delivered');
  await others.getByRole('button', { name: 'Track another parcel' }).click();
  await expect(frontDoor(page)).toBeVisible();
});

test('opens the parcel the deliveries already had when the kept number is one of theirs', async ({ page }) => {
  await track(page, '1234567899');
  await expect(status(page)).toHaveText('Ready for pickup');
  // The header's button keeps the parcel too.
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Explore the demo' }).click();
  await expect(page.getByRole('dialog', { name: /New sneakers/ })).toBeVisible();
  await expect(page.getByText('You already follow this parcel')).toBeVisible();
});
