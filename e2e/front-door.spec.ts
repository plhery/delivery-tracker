import { expect, test, type Page } from '@playwright/test';

// The demo build keeps lookups in the browser; every number here is fictional.
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const parcelAddress = /\/p\/[2-9A-HJ-NP-Za-km-z]{12}$/;
const field = (page: Page) => page.getByRole('textbox', { name: 'Tracking number or link' });
const device = (page: Page) => page.getByRole('region', { name: 'On this device' });
/** What the door says out loud; the framework's own route announcer stands outside it. */
const said = (page: Page) => page.locator('main').getByRole('alert');
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function openDoor(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
}

/** Pastes into the field the way a browser does: a paste event, then the text arriving in one piece. */
async function paste(page: Page, text: string) {
  await field(page).focus();
  await field(page).evaluate((element, value) => {
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
    document.execCommand('insertText', false, value);
  }, text);
}

/** Tracks a typed number and comes back to the door, where it is now listed. */
async function follow(page: Page, number: string) {
  await field(page).fill(number);
  await field(page).press('Enter');
  await expect(page).toHaveURL(parcelAddress);
  const address = page.url();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  return address;
}

test('a pasted message goes straight to the parcel: the number is found, the carrier named, the page opened', async ({ page }) => {
  await openDoor(page);
  await paste(page, 'Good news, your order has shipped!\nUPS tracking: 1ZDEMO202600000001\nExpected delivery: Wednesday');
  await expect(page).toHaveURL(parcelAddress);
  await expect(page.locator('.peekp-main')).toHaveAttribute('data-entrance', 'reveal');
  await expect(page.getByLabel('UPS', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1ZDEMO202600000001', { exact: true }).first()).toBeVisible();
  // Back at the door, the parcel is on this device.
  await page.goBack();
  await expect(device(page).getByRole('link')).toHaveCount(1);
  await expect(device(page).getByRole('link')).toContainText('1ZDEMO2…0001');
  await expect(field(page)).toHaveValue('');
});

test('a typed number waits for Track, with its carrier on the line and its label on Pip', async ({ page }) => {
  await openDoor(page);
  await expect(page.locator('.door-pip')).toBeVisible();
  await field(page).pressSequentially('99.34.123456.78901234');
  const line = page.locator('.door-line');
  await expect(line).toContainText('Swiss Post');
  await expect(line).toContainText('Detected carrier');
  await expect(page.locator('.door-pip .parcel-illustration__label-number')).toHaveText('99.34.123456.78901234');
  // Nothing moves on its own while typing.
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Track', exact: true }).click();
  await expect(page).toHaveURL(parcelAddress);
  await expect(page.getByLabel('Swiss Post', { exact: true }).first()).toBeVisible();
});

test('several numbers in one text are listed, and the chosen one is tracked', async ({ page }) => {
  await openDoor(page);
  await paste(page, 'Your order ships in 3 parcels:\nUPS 1ZDEMO202600000001\nUPS 1ZDEMO202600000002\nSwiss Post 99.34.123456.78901234');
  const numbers = page.getByRole('group', { name: '3 tracking numbers in this text' });
  await expect(numbers.getByRole('radio')).toHaveCount(3);
  await expect(numbers.getByRole('radio').first()).toBeChecked();
  await expect(page).toHaveURL(/\/$/);
  await numbers.getByText('99.34.123456.78901234').click();
  await page.getByRole('button', { name: 'Track this one', exact: true }).click();
  await expect(page).toHaveURL(parcelAddress);
  await expect(page.getByText('99.34.123456.78901234', { exact: true }).first()).toBeVisible();
});

test('says what is wrong with the input: no number, an order number, a check digit that does not add up', async ({ page }) => {
  await openDoor(page);
  await field(page).fill('Thanks for your order! We’ll let you know as soon as it ships.');
  await field(page).press('Enter');
  await expect(said(page)).toHaveText('We couldn’t find a tracking number. Paste the number or a tracking link.');
  await expect(page.getByRole('region', { name: 'What tracking numbers look like' }).getByRole('listitem')).toHaveCount(4);
  await expect(field(page)).toHaveValue('Thanks for your order! We’ll let you know as soon as it ships.');

  await field(page).fill('302-4571983-2294617');
  await expect(page.getByRole('note')).toContainText('That looks like an Amazon order number');
  await expect(page.getByRole('link', { name: 'Open my Amazon orders' })).toHaveAttribute('target', '_blank');

  await field(page).fill('LX1234567B5DE');
  await expect(page.getByText('This number’s check digit doesn’t add up. A letter may have been read as a digit.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Track it as typed' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Did you mean LX123456785DE?' }).click();
  await expect(page).toHaveURL(parcelAddress);
  await expect(page.getByText('LX123456785DE', { exact: true }).first()).toBeVisible();
});

test('asks for the postcode a chosen carrier needs before opening the parcel', async ({ page }) => {
  await openDoor(page);
  await field(page).fill('DEMO4471203');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Carrier' });
  await picker.getByRole('combobox', { name: 'Search carriers' }).fill('GLS Switz');
  await picker.getByRole('option', { name: /GLS Switzerland/ }).click();
  const postcode = page.getByRole('textbox', { name: 'Delivery postcode' });
  await expect(postcode).toBeFocused();
  await expect(page.getByText('Only sent to GLS Switzerland, never shown on shared links.')).toBeVisible();
  await postcode.press('Enter');
  await expect(said(page)).toHaveText('Enter the delivery postcode shown on your order.');
  await expect(page).toHaveURL(/\/$/);
  await postcode.fill('8004');
  await postcode.press('Enter');
  await expect(page).toHaveURL(parcelAddress);
  await expect(page.getByText('DEMO4471203', { exact: true }).first()).toBeVisible();
});

test('lists the parcels of this device, opens one already followed instead of looking it up again, and forgets them all', async ({ page }) => {
  await openDoor(page);
  const first = await follow(page, '1ZDEMO202600000001');
  const second = await follow(page, 'DEMOGLS20260001');
  expect(second).not.toBe(first);
  const links = device(page).getByRole('link');
  await expect(links).toHaveCount(2);
  // The parcel due first leads on a card that draws its route; the other follows with its carrier and where it stands.
  // The list takes Pip's place.
  await expect(links.nth(0)).toContainText('DEMOGLS…0001');
  await expect(links.nth(0)).toHaveClass(/door-nextup/);
  await expect(links.nth(0).locator('strong')).toHaveText('In transit');
  await expect(links.nth(0).locator('.door-nextup__map').getByText('Berlin', { exact: true })).toBeVisible();
  await expect(links.nth(1)).toContainText('1ZDEMO2…0001');
  await expect(links.nth(1).getByLabel('UPS', { exact: true })).toBeVisible();
  await expect(links.nth(1)).toContainText('In transit');
  // Its own journey is drawn small at the end of its card, in quiet marks.
  await expect(links.nth(1).locator('.card-route [data-quiet]')).toHaveAttribute('data-mode', 'journey');
  await expect(links.nth(1).locator('.card-route g[data-kind="current"] circle')).toHaveCount(1);
  await expect(page.locator('.door-pip')).toHaveCount(0);
  await expect(device(page).getByText('Kept in this browser only.')).toBeVisible();

  // A card opens its parcel.
  await links.nth(0).click();
  await expect(page).toHaveURL(second);
  await page.goBack();

  // The same number again opens the same link: no second parcel appears, and the parcel due first still leads.
  await field(page).fill('1z demo 2026 0000 0001');
  await expect(page.locator('.door-line')).toContainText('already on this device');
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  await expect(page).toHaveURL(first);
  await page.goBack();
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toContainText('DEMOGLS…0001');
  await expect(links.nth(1)).toContainText('1ZDEMO2…0001');

  await device(page).getByRole('button', { name: 'Forget all' }).click();
  const question = page.getByRole('group', { name: 'Forget these 2 parcels?' });
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(links).toHaveCount(2);
  await device(page).getByRole('button', { name: 'Forget all' }).click();
  await page.getByRole('group', { name: 'Forget these 2 parcels?' }).getByRole('button', { name: 'Forget', exact: true }).click();
  await expect(device(page)).toHaveCount(0);
  await expect(page.locator('.door-pip')).toBeVisible();
  // Forgotten for good: the list stays empty, and the links lead nowhere.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(device(page)).toHaveCount(0);
  await page.goto(first);
  await expect(page.getByRole('heading', { level: 1, name: 'This parcel has been forgotten' })).toBeVisible();
});

test('the Paste button reads the clipboard and goes on like any paste', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium lets a test grant the clipboard.');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDoor(page);
  await page.evaluate(() => navigator.clipboard.writeText('Swiss Post 99.34.123456.78901234'));
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await expect(page).toHaveURL(parcelAddress);
  await expect(page.getByText('99.34.123456.78901234', { exact: true }).first()).toBeVisible();
});

test('explains how to paste by hand when the browser keeps the clipboard to itself', async ({ page }) => {
  await openDoor(page);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await expect(said(page)).toContainText('Couldn’t paste');
  await expect(field(page)).toBeFocused();
  await field(page).pressSequentially('1ZDEMO202600000001');
  await expect(page.getByText('Couldn’t paste')).toHaveCount(0);
});

test('"Sign in" opens the sign-in step, and Back returns to the door', async ({ page }) => {
  await openDoor(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
});

test('fits a 320 px phone in German and in the dark, in every state of the field, and holds still when the carrier is found', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('deliveryTrackerLocale', 'de'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wo ist mein Paket?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeEnabled();
  const input = page.getByRole('textbox');
  expect(await fits(page)).toBe(true);

  for (const text of [
    'Bestellung unterwegs:\nUPS 1ZDEMO202600000001\nUPS 1ZDEMO202600000002\nSwiss Post 99.34.123456.78901234',
    'Danke für deine Bestellung! Wir melden uns, sobald sie unterwegs ist.',
    '302-4571983-2294617',
    'LX1234567B5DE',
    'https://www.dhl.com/ch-de/home/tracking.html?tracking-id=1234567899&submit=1',
  ]) {
    // Typed text is answered once it has rested.
    await input.fill(text);
    await expect(page.locator('.door-feedback > *').first()).toBeVisible();
    expect(await fits(page)).toBe(true);
  }
  await expect(page).toHaveURL(/\/$/);

  // The carrier's line holds its place: naming the carrier moves nothing below it.
  await input.fill('DEMO4471203');
  await expect(page.locator('.door-line')).toContainText('Paketdienst');
  const before = await page.locator('.door-pip').boundingBox();
  await page.getByRole('button', { name: 'Ändern', exact: true }).click();
  await page.getByRole('dialog').getByRole('combobox').fill('Planzer');
  await expect(page.getByRole('dialog').getByRole('option').first()).toContainText('Planzer');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  await expect(page.locator('.door-line')).toContainText('Planzer');
  const after = await page.locator('.door-pip').boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(await fits(page)).toBe(true);
});

test('shows still frames to someone who asked for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDoor(page);
  await field(page).fill('1ZDEMO202600000001');
  const running = await page.evaluate(() => document.getAnimations().filter((animation) => {
    const timing = animation.effect?.getComputedTiming();
    return animation.playState === 'running' && Number(timing?.duration) > 1;
  }).length);
  expect(running).toBe(0);
  await field(page).press('Enter');
  await expect(page).toHaveURL(parcelAddress);
});
