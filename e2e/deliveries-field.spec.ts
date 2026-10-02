import { expect, test, type Page } from '@playwright/test';

const failures = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, context, browserName }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => { window.localStorage.clear(); window.localStorage.setItem('sdt.web.experience.v1', 'demo'); });
});
test.afterEach(async ({ page }) => { expect(failures.get(page) ?? []).toEqual([]); });

const field = (page: Page) => page.getByRole('textbox', { name: 'Track a parcel' });
const pasteButton = (page: Page) => page.getByRole('button', { name: 'Paste', exact: true });
const cards = (page: Page) => page.locator('.parcel-card-swipe');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Add a parcel' });

/** The demo's deliveries, with the field live. */
async function deliveries(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Coffee beans ☕', { exact: true })).toBeVisible();
  await expect(page.locator('.deliveries-field__paste')).toBeEnabled();
}

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

/** Where the focus rests after the field has done its work: the field, or on a touch screen its Paste button. */
const home = (page: Page, isMobile: boolean) => isMobile ? pasteButton(page) : field(page);

test('stands under a phone’s title row and inside a wide screen’s header, on every tab there', async ({ page, isMobile }) => {
  await deliveries(page);
  const box = (await page.locator('.deliveries-field').boundingBox())!;
  const heading = (await page.getByRole('heading', { name: 'On the way' }).boundingBox())!;
  const account = (await page.locator('.account-trigger').boundingBox())!;
  await expect(field(page)).toHaveAttribute('placeholder', 'Paste a number, link, or message');
  await expect(page.getByRole('button', { name: 'Add a parcel', exact: true })).toHaveCount(0);

  if (isMobile) {
    const title = (await page.getByRole('heading', { name: 'Deliveries', level: 1 }).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(box.y + box.height).toBeLessThanOrEqual(heading.y);
    expect(box.x).toBe(20);
    expect(box.width).toBe(page.viewportSize()!.width - 40);
    // The title row stays in view; the field scrolls away with the deliveries.
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(field(page)).not.toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Deliveries', level: 1 })).toBeInViewport();
    // The other tabs have no field on a phone.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.app__navigation').getByRole('button', { name: 'Passport' }).click();
    await expect(field(page)).toBeHidden();
    return;
  }

  const lockup = (await page.locator('.app__brand .peek-lockup').boundingBox())!;
  const tabs = (await page.locator('.app__navigation').boundingBox())!;
  expect(box.width).toBe(480);
  expect(box.x).toBeGreaterThan(lockup.x + lockup.width);
  expect(box.x + box.width).toBeLessThan(account.x);
  expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);
  expect(tabs.y + tabs.height).toBeLessThanOrEqual(heading.y);
  // The header is the same on every tab: nothing jumps when the page changes.
  for (const tab of ['Passport', 'Friends', 'Deliveries']) {
    await page.locator('.app__navigation').getByRole('button', { name: tab }).click();
    await expect(page.locator('.app__navigation').getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page');
    await expect(field(page)).toBeVisible();
    expect(await page.locator('.deliveries-field').boundingBox()).toEqual(box);
    expect(await page.locator('.app__navigation').boundingBox()).toEqual(tabs);
  }
});

test('adds what the Paste button brings at once, and takes it back with “Don’t keep”', async ({ page, isMobile, browserName }) => {
  test.skip(browserName !== 'chromium', 'Reads the clipboard, which only Chromium lets a test fill.');
  await deliveries(page);
  const before = await cards(page).count();
  await page.evaluate(() => navigator.clipboard.writeText('Your order is on its way.\nTrack it: 1ZDEMO202600000009'));
  await pasteButton(page).click();

  const toast = page.locator('.undo-toast');
  await expect(toast).toHaveText(/Added to your deliveries\s*Don’t keep/);
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(before + 1);
  const card = cards(page).filter({ hasText: 'Added to tracking' });
  await expect(card).toBeInViewport();
  await expect(field(page)).toHaveValue('');
  await expect(home(page, isMobile)).toBeFocused();

  await toast.getByRole('button', { name: 'Don’t keep' }).click();
  await expect(page.locator('.action-toast')).toHaveText('Removed from your deliveries');
  await expect(cards(page)).toHaveCount(before);
  await expect(toast).toHaveCount(0);
  await expect(home(page, isMobile)).toBeFocused();
  // It is gone for good, not archived.
  await page.reload();
  await expect(page.getByText('Coffee beans ☕', { exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(before);
  await expect(page.locator('.archived-section')).not.toContainText('1ZDEMO202600000009');
});

test('waits for Enter while typing, then adds and celebrates the new card', async ({ page, isMobile }) => {
  await deliveries(page);
  const before = await cards(page).count();
  await field(page).pressSequentially('99.34.111111.22222222');
  await expect(page.getByRole('button', { name: 'Track', exact: true })).toBeVisible();
  // Longer than the pause after which typing counts as finished elsewhere: nothing is added without Enter.
  await page.waitForTimeout(1_200);
  await expect(cards(page)).toHaveCount(before);
  await expect(page.locator('.undo-toast')).toHaveCount(0);

  await field(page).press('Enter');
  const card = cards(page).filter({ hasText: 'Added to tracking' });
  await expect(card).toHaveAttribute('data-celebrating', 'rumble');
  await expect(page.locator('.undo-toast')).toContainText('Added to your deliveries');
  await expect(field(page)).toHaveValue('');
  // The card celebrates without taking the focus from the field.
  await expect(home(page, isMobile)).toBeFocused();
  await expect(page.locator('.parcel-added-burst')).toHaveCount(0);
  await card.locator('.parcel-card').click();
  await expect(page.getByRole('dialog', { name: 'Parcel', exact: true })).toContainText('99.34.111111.22222222');
});

test('opens a parcel the deliveries already hold, and says so', async ({ page }) => {
  await deliveries(page);
  const before = await cards(page).count();
  await field(page).fill('1Z DEMO 2026 0000 0001');
  await field(page).press('Enter');
  await expect(page.getByRole('dialog', { name: /^Kind of Blue/ })).toBeVisible();
  await expect(page.locator('.action-toast')).toHaveText('You already follow this parcel');
  await expect(sheet(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(before);
  await expect(field(page)).toHaveValue('');
});

test('hands what it cannot settle to the Add sheet, where the parcel is finished', async ({ page, isMobile }) => {
  await deliveries(page);
  const tracking = sheet(page).getByLabel('Tracking number or link');

  // Several numbers in one text.
  await field(page).fill('1ZDEMO202600000008 and 1ZDEMO202600000009');
  await field(page).press('Enter');
  await expect(tracking).toHaveValue('1ZDEMO202600000008 and 1ZDEMO202600000009');
  await expect(tracking).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(field(page)).toHaveValue('');
  await expect(home(page, isMobile)).toBeFocused();

  // A text without a number.
  await field(page).fill('hello there');
  await field(page).press('Enter');
  await expect(sheet(page).getByText(/couldn’t find a tracking number/i)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);

  // A carrier that needs the delivery postcode: the sheet asks for it, then adds.
  await field(page).fill('https://gls-group.eu/DE/de/paketverfolgung?match=123456789018');
  await field(page).press('Enter');
  await expect(sheet(page).getByText('GLS Germany', { exact: true })).toBeVisible();
  const add = sheet(page).getByRole('button', { name: 'Add parcel', exact: true });
  await expect(add).toBeDisabled();
  await sheet(page).getByLabel(/^Delivery postcode/).fill('8000');
  await add.click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(cards(page).filter({ hasText: 'GLS' }).filter({ hasText: 'Added to tracking' })).toBeVisible();
  // A parcel finished in the sheet was added on purpose: no offer to take it back.
  await expect(page.locator('.undo-toast')).toHaveCount(0);
});

test('says what went wrong under the field without moving anything', async ({ page, isMobile, browserName }) => {
  test.skip(browserName !== 'chromium', 'Layout shifts are measured with Chromium’s own observer.');
  await deliveries(page);
  await page.evaluate(() => {
    navigator.clipboard.readText = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
    const shifts = { total: 0 };
    Object.assign(window, { fieldShifts: shifts });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) shifts.total += (entry as PerformanceEntry & { value: number }).value;
    }).observe({ type: 'layout-shift' });
  });
  const places = () => page.evaluate(() => ['.deliveries-field__box', '.app__navigation', '.delivery-overview', '.parcel-card']
    .map((selector) => JSON.stringify(document.querySelector(selector)!.getBoundingClientRect())));
  // The cards arrive with a little motion: measure once they have come to rest.
  let before = await places();
  await expect.poll(async () => {
    const earlier = before;
    await page.waitForTimeout(150);
    before = await places();
    return before.join() === earlier.join();
  }).toBe(true);

  await pasteButton(page).click();
  const note = page.locator('.deliveries-field__line--note');
  await expect(note).toContainText(isMobile ? 'Long-press the field and choose Paste.' : 'Click the field and paste there.');
  await expect(page.locator('.deliveries-field__feedback')).toHaveAttribute('aria-live', 'polite');
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveAccessibleDescription(/didn’t let Peek read the clipboard/);
  await page.waitForTimeout(400);
  expect(await places()).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as { fieldShifts: { total: number } }).fieldShifts.total)).toBe(0);
  const bounds = (await note.boundingBox())!;
  const box = (await page.locator('.deliveries-field__box').boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(box.y + box.height);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width + 1);
  await noOverflow(page);

  // The note is about what was just tried: typing drops it.
  await field(page).pressSequentially('1');
  await expect(note).toHaveCount(0);
  expect(await places()).toEqual(before);
});

test('fits a 320 px screen in German and in the dark', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => {
    window.localStorage.setItem('deliveryTrackerLocale', 'de');
    window.localStorage.setItem('sdt.appearance.v1', 'dark');
  });
  await page.goto('/');
  await expect(page.getByText('Kaffeebohnen ☕', { exact: true })).toBeVisible();
  await expect(page.locator('.deliveries-field__paste')).toBeEnabled();
  const german = page.getByRole('textbox', { name: 'Paket verfolgen' });
  await expect(german).toBeVisible();
  await expect(page.locator('.deliveries-field__paste')).toHaveText('Einfügen');
  await expect(page.locator('.deliveries-field__box')).toHaveCSS('background-color', 'rgb(36, 40, 36)');
  const box = (await page.locator('.deliveries-field').boundingBox())!;
  expect(box.x).toBe(16);
  expect(box.width).toBe(288);
  await noOverflow(page);

  await german.fill('1ZDEMO202600000009');
  await expect(page.getByRole('button', { name: 'Verfolgen', exact: true })).toBeVisible();
  expect(await page.locator('.deliveries-field').boundingBox()).toEqual(box);
  await noOverflow(page);
  await german.fill('');

  if (browserName === 'chromium') {
    await page.evaluate(() => { navigator.clipboard.readText = () => Promise.resolve(''); });
    await page.locator('.deliveries-field__paste').click();
    const note = page.locator('.deliveries-field__line--note');
    await expect(note).toContainText('Die Zwischenablage ist leer');
    const bounds = (await note.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(16);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(304);
    await noOverflow(page);
  }

  await german.fill('1ZDEMO202600000009');
  await german.press('Enter');
  const toast = page.locator('.undo-toast');
  await expect(toast).toContainText('Zu deinen Sendungen hinzugefügt');
  await expect(toast.getByRole('button', { name: 'Nicht behalten' })).toBeVisible();
  const toastBounds = (await toast.boundingBox())!;
  expect(toastBounds.x).toBeGreaterThanOrEqual(0);
  expect(toastBounds.x + toastBounds.width).toBeLessThanOrEqual(320);
  await noOverflow(page);
});
