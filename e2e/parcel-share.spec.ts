import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { allowCopying, copied, track } from './peek';

// The demo build keeps parcel links in the browser: every number here is fictional, and a
// second browser reads a link as a viewer once it is handed the first one's demo links.
const DEMO_LINKS = 'sdt.peek.demo.v1';
const errors = new WeakMap<Page, string[]>();
function watch(page: Page) {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
}
test.beforeEach(async ({ page }) => { watch(page); });
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const status = (page: Page) => page.getByRole('heading', { level: 1 });
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const actions = (page: Page) => page.locator('.peekp-actions');

/** Gives another browser the demo's links as the owner's browser has them now, and shows it `address`. */
async function show(owner: Page, viewer: Page, address: string) {
  const links = await owner.evaluate((key) => localStorage.getItem(key), DEMO_LINKS);
  await viewer.goto('/privacy.html');
  await viewer.evaluate(([key, value]) => localStorage.setItem(key, value!), [DEMO_LINKS, links] as const);
  await viewer.goto(address);
}

async function anotherBrowser(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport, ...options });
  const page = await context.newPage();
  watch(page);
  return { context, page };
}

/**
 * Headless browsers refuse notifications whatever a test grants, so the browser's answer is
 * stood in for: asked once, it says `answer`, and remembers it across reloads as a real one does.
 * Playwright's WebKit has no notifications at all: there the stand-in is the whole of them.
 */
async function answerNotifications(page: Page, answer: 'granted' | 'denied') {
  await page.addInitScript((reply) => {
    const key = 'e2e.notifications';
    if (typeof Notification === 'undefined') Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: class {} });
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => sessionStorage.getItem(key) ?? 'default' });
    Notification.requestPermission = async () => {
      sessionStorage.setItem(key, reply);
      return reply;
    };
  }, answer);
}

async function openShare(page: Page) {
  await actions(page).getByRole('button', { name: 'Share', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Share this parcel' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('the owner chooses what the link shows: a recipient reads the number’s end until the number is shown', async ({ page, browser }) => {
  await track(page, '1234567899');
  await expect(status(page)).toHaveText('Ready for pickup');
  const address = page.url();
  const sheet = await openShare(page);
  const number = sheet.getByRole('switch', { name: 'Show the tracking number' });
  await expect(number).not.toBeChecked();
  await expect(sheet.getByText('Off, it reads ••• 99')).toBeVisible();
  await expect(sheet.getByText(/Anyone with the link sees the journey, never a pickup code/)).toBeVisible();
  // On its way, the day the link stops working is not known yet.
  await expect(sheet.getByText('The link works until 30 days after delivery.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Create an account and it works for as long as you share it' })).toBeVisible();

  const { context, page: recipient } = await anotherBrowser(browser);
  await show(page, recipient, address);
  await expect(recipient.getByText('Shared with you · no account needed')).toBeVisible();
  await expect(status(recipient)).toHaveText('Ready for pickup');
  await expect(recipient.getByText('••• 99', { exact: true })).toBeVisible();
  await expect(recipient.getByText('1234567899')).toHaveCount(0);
  await expect(recipient.getByRole('button', { name: 'Copy tracking number' })).toHaveCount(0);
  // Forgetting and the share sheet are the owner's.
  await expect(recipient.getByRole('button', { name: 'Forget it now' })).toHaveCount(0);
  await recipient.getByRole('button', { name: 'Share this parcel' }).click();
  await expect(recipient.getByRole('dialog')).toHaveCount(0);

  // The switch is a real one: the keyboard flips it, and it is saved at once.
  await number.focus();
  await page.keyboard.press('Space');
  await expect(number).toBeChecked();
  await show(page, recipient, address);
  await expect(recipient.getByText('1234567899', { exact: true }).first()).toBeVisible();
  await expect(recipient.getByRole('button', { name: 'Copy tracking number' })).toBeVisible();
  // The sheet remembers what it set when it opens again.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(actions(page).getByRole('button', { name: 'Share', exact: true })).toBeFocused();
  await expect((await openShare(page)).getByRole('switch', { name: 'Show the tracking number' })).toBeChecked();
  expect(errors.get(recipient)).toEqual([]);
  await context.close();
});

test('once the parcel is delivered, the share sheet and the recipient read the day the link stops working', async ({ page, browser }) => {
  await track(page, '1ZDEMO202600000009');
  const address = page.url();
  await expect(status(page)).toHaveText('In transit');
  const check = page.getByRole('button', { name: /Check now$/ });
  await check.click();
  await expect(status(page)).toHaveText('Out for delivery');
  await check.click();
  await expect(status(page)).toHaveText('Delivered');
  const sheet = await openShare(page);
  await expect(sheet.getByText(/^The link works until \d+ \p{L}+\./u)).toBeVisible();
  await page.keyboard.press('Escape');

  const { context, page: recipient } = await anotherBrowser(browser);
  await show(page, recipient, address);
  await expect(status(recipient)).toHaveText('Delivered');
  await expect(recipient.getByText(/^Shared with you · the link works until \d+ \p{L}+$/u)).toBeVisible();
  // The line above the card says it: the footer has nothing to add.
  await expect(recipient.getByText(/Peek forgets this parcel/)).toHaveCount(0);
  expect(errors.get(recipient)).toEqual([]);
  await context.close();
});

test('a gift stays a surprise until it is delivered, then shows its note and what is inside', async ({ page, browser }) => {
  await allowCopying(page);
  await track(page, 'DEMOCHOC20260001');
  await expect(status(page)).toHaveText('Out for delivery');
  await page.getByRole('button', { name: 'Name it' }).click();
  await page.keyboard.type('Belgian chocolate');
  await page.keyboard.press('Enter');

  const sheet = await openShare(page);
  await sheet.getByRole('switch', { name: 'It’s a gift' }).check();
  await sheet.getByRole('textbox', { name: 'A note, shown once it’s delivered' }).fill('Happy birthday, Alex! Enjoy every piece.');
  await sheet.getByRole('textbox', { name: 'From' }).fill('Sam');
  await sheet.getByRole('switch', { name: 'Show what’s inside' }).check();
  await sheet.getByRole('button', { name: 'Copy' }).click();
  await expect(sheet.getByText('Link copied')).toBeVisible();
  const link = await copied(page);
  // The name, the note and the signature travel after the #, which no server sees.
  expect(link).toMatch(/\/p\/[2-9A-HJ-NP-Za-km-z]{12}#n=Belgian%20chocolate&g=Happy%20birthday.*&f=Sam$/);
  await sheet.getByRole('button', { name: 'Close' }).click();
  // The sender keeps the usual page, marked as a gift.
  await expect(page.locator('.peekp-card__gift')).toHaveText('Gift');
  await expect(status(page)).toHaveText('Out for delivery');

  const { context: other, page: recipient } = await anotherBrowser(browser);
  await show(page, recipient, link);
  await expect(status(recipient)).toHaveText('Something’s on its way to you');
  await expect(recipient).toHaveTitle('Something’s on its way to you · Peek');
  await expect(recipient.locator('.peekp-card__detail')).toHaveText(/^Arrives today/);
  await expect(recipient.getByText('What’s inside and who sent it stay a surprise until it’s delivered.')).toBeVisible();
  await expect(recipient.locator('.parcel-illustration__ribbon')).toBeVisible();
  // The browser has the words; the page shows none of them, nor the sender or the number.
  expect(recipient.url()).toContain('g=Happy%20birthday');
  await expect(recipient.locator('body')).not.toContainText(/Belgian chocolate|Happy birthday|Chocolaterie|chocolatier|Brussels|DEMOCHOC|Tracking number/i);
  await expect(recipient.locator('body')).not.toContainText(/\bSam\b/);
  await expect(recipient.getByText('Left the sender')).toHaveCount(1);
  await expect(recipient.getByRole('button', { name: 'Ping me too' })).toBeVisible();
  expect(await fits(recipient)).toBe(true);
  // The device's list does not learn the name either.
  await recipient.goto('/');
  await expect(recipient.getByRole('region', { name: 'On this device' })).not.toContainText('Belgian chocolate');

  // The parcel arrives.
  await page.getByRole('button', { name: /Check now$/ }).click();
  await expect(status(page)).toHaveText('Delivered');
  await show(page, recipient, link);
  await expect(status(recipient)).toHaveText('It’s here');
  await expect(recipient.locator('.peekp-card__detail')).toHaveText(/^Delivered today at \d\d:\d\d$/);
  await expect(recipient.getByText('Happy birthday, Alex! Enjoy every piece.')).toBeVisible();
  await expect(recipient.getByText('— Sam')).toBeVisible();
  await expect(recipient.locator('.peekp-giftnote__inside')).toHaveText('Inside: Belgian chocolate');
  expect(await fits(recipient)).toBe(true);
  expect(errors.get(recipient)).toEqual([]);
  await other.close();
});

test('stopping the sharing blanks the link for a recipient, and sharing again brings it back', async ({ page, browser }) => {
  await track(page, 'DEMOGLS20260009');
  await expect(status(page)).toHaveText('In transit');
  const address = page.url();
  const { context, page: recipient } = await anotherBrowser(browser);
  await show(page, recipient, address);
  await expect(status(recipient)).toHaveText('In transit');

  const sheet = await openShare(page);
  await sheet.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(sheet.getByText('Sharing is stopped. The link shows nothing to anyone else.')).toBeVisible();
  await expect(sheet.getByRole('switch')).toHaveCount(0);
  await show(page, recipient, address);
  await expect(recipient.getByRole('heading', { level: 1, name: 'This parcel isn’t shared anymore' })).toBeVisible();
  await expect(recipient.getByText('The person who shared it stopped sharing. If it’s yours, paste its tracking number to follow it again.')).toBeVisible();
  await expect(recipient).toHaveTitle('This parcel isn’t shared anymore · Peek');
  await expect(recipient.getByText('In transit')).toHaveCount(0);
  expect(await fits(recipient)).toBe(true);
  // It is not the page of a forgotten link, and it leads to the front door.
  await expect(recipient.getByText(/has been forgotten/)).toHaveCount(0);
  await recipient.getByRole('button', { name: 'Where’s my parcel?', exact: true }).click();
  await expect(recipient.getByRole('heading', { name: 'Where’s my parcel?' })).toBeVisible();
  await expect(recipient.getByRole('region', { name: 'On this device' })).toHaveCount(0);

  // The owner still follows the parcel, and can share it again.
  await sheet.getByRole('button', { name: 'Share again' }).click();
  await expect(sheet.getByRole('button', { name: 'Stop sharing' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(status(page)).toHaveText('In transit');
  await show(page, recipient, address);
  await expect(status(recipient)).toHaveText('In transit');
  expect(errors.get(recipient)).toEqual([]);
  await context.close();
});

test('alerts: turned on only when asked, changed and turned off, and gone once the parcel is delivered', async ({ page }) => {
  await answerNotifications(page, 'granted');
  await track(page, 'DEMOCHOC20260001');
  await expect(status(page)).toHaveText('Out for delivery');
  await actions(page).getByRole('button', { name: /^Ping me/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Ping me when it arrives' });
  await expect(sheet.getByRole('radio', { name: /^Notifications in this browser/ })).toBeChecked();
  await expect(sheet.getByText('Works while this page is closed. Stops when the parcel is delivered.')).toBeVisible();
  await expect(sheet.getByRole('radio', { name: /^Add the delivery window to my calendar/ })).toBeVisible();
  await expect(sheet.getByText('This is the demo: nothing is sent.')).toBeVisible();
  // The row that invites to sign in promises what an account does, and no email.
  await expect(sheet.getByText('Alerts on all your devices')).toBeVisible();
  await expect(sheet).not.toContainText(/e-?mail/i);
  await expect(sheet.getByRole('button', { name: 'Important steps' })).toHaveAttribute('aria-pressed', 'true');

  // Opening the sheet asked the browser nothing: only "Turn on" does.
  expect(await page.evaluate(() => Notification.permission)).toBe('default');
  await sheet.getByRole('button', { name: 'Delivery only' }).click();
  await sheet.getByRole('button', { name: 'Turn on' }).click();
  await expect(sheet.getByText('Alerts are on in this browser')).toBeVisible();
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  await expect(sheet.getByRole('button', { name: 'Delivery only' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Every scan' }).click();
  await expect(sheet.getByText('Preferences saved')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  const ping = actions(page).getByRole('button', { name: 'Alerts on' });
  await expect(ping).toBeFocused();

  // A reload keeps it on; turning off brings the offer back.
  await page.reload();
  await ping.click();
  await expect(sheet.getByRole('button', { name: 'Every scan' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Turn off' }).click();
  await expect(sheet.getByRole('button', { name: 'Turn on' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Turn on' }).click();
  await expect(sheet.getByText('Alerts are on in this browser')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();

  // Delivered: nothing is left to ping about, and "I have it" offers the gentle exit.
  await page.getByRole('button', { name: /Check now$/ }).click();
  await expect(status(page)).toHaveText('Delivered');
  await expect(page.getByRole('button', { name: /Ping me|Alerts on/ })).toHaveCount(0);
  await actions(page).getByRole('button', { name: 'I have it' }).click();
  const exit = page.getByRole('dialog', { name: 'Glad it arrived' });
  await expect(exit).toContainText(/Peek forgets this parcel on \d+ \p{L}+\./u);
  await exit.getByRole('button', { name: 'Keep it' }).click();
  await expect(exit).toHaveCount(0);
  await expect(status(page)).toHaveText('Delivered');
  await actions(page).getByRole('button', { name: 'I have it' }).click();
  await exit.getByRole('button', { name: 'Forget it now' }).click();
  await expect(page.getByRole('heading', { name: 'Where’s my parcel?' })).toBeVisible();
  await expect(page.getByText('Parcel forgotten')).toBeVisible();
});

test('alerts: a browser that refuses notifications gets plain guidance and the calendar file', async ({ page }) => {
  await answerNotifications(page, 'denied');
  await track(page, 'DEMOCHOC20260001');
  await expect(status(page)).toHaveText('Out for delivery');
  await actions(page).getByRole('button', { name: /^Ping me/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Ping me when it arrives' });
  await sheet.getByRole('button', { name: 'Turn on' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Notifications are blocked for this site. Allow them in your browser’s site settings, then turn on again.');
  await expect(sheet.getByRole('radio', { name: /^Notifications in this browser/ })).toBeDisabled();
  await expect(sheet.getByRole('button', { name: 'Turn on' })).toHaveCount(0);
  await expect(sheet.getByRole('radio', { name: /^Add the delivery window to my calendar/ })).toBeChecked();
  const download = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Add to calendar' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('peek-delivery.ics');
  await expect(sheet.getByText('Calendar file ready')).toBeVisible();
  const stream = await file.createReadStream();
  let calendar = '';
  for await (const chunk of stream) calendar += chunk.toString();
  expect(calendar).toMatch(/^BEGIN:VCALENDAR\r\n/);
  expect(calendar).toMatch(/DTSTART;VALUE=DATE:\d{8}\r\n/);
  expect(calendar).toContain('SUMMARY:Out for delivery\r\n');
  expect(calendar).toMatch(/URL:http:\/\/[^\r]+\/p\/[2-9A-HJ-NP-Za-km-z]{12}\r\n/);
});

test('alerts: a browser without notifications is told so, and offered the calendar file instead', async ({ page }) => {
  // Playwright's WebKit is such a browser; Chromium is made one.
  await page.addInitScript(() => { Object.defineProperty(window, 'Notification', { configurable: true, value: undefined }); });
  await track(page, 'DEMOCHOC20260001');
  await expect(status(page)).toHaveText('Out for delivery');
  await actions(page).getByRole('button', { name: /^Ping me/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Ping me when it arrives' });
  const notifications = sheet.getByRole('radio', { name: /^Notifications in this browser/ });
  await expect(notifications).toBeDisabled();
  await expect(notifications).not.toBeChecked();
  await expect(sheet.getByText('This browser can’t show notifications.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Turn on' })).toHaveCount(0);
  await expect(sheet.getByRole('radio', { name: /^Add the delivery window to my calendar/ })).toBeChecked();
  await expect(sheet.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
  // An account's alerts do not depend on this browser: the way to them stays.
  await expect(sheet.getByText('Alerts on all your devices')).toBeVisible();
});

test('alerts: an iPhone outside its Home Screen app gets the three steps, not a button that cannot work', async ({ browser, page }) => {
  await track(page, 'DEMOGLS20260009');
  await expect(status(page)).toHaveText('In transit');
  const { context, page: phone } = await anotherBrowser(browser, {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await show(page, phone, page.url());
  await phone.getByRole('button', { name: 'Ping me too' }).click();
  const sheet = phone.getByRole('dialog', { name: 'Alerts on iPhone' });
  await expect(sheet.getByText('Safari only sends notifications from sites on your Home Screen. It takes three taps.')).toBeVisible();
  await expect(sheet.getByRole('listitem')).toHaveText(['1Tap Share in Safari’s toolbar', '2Choose Add to Home Screen', '3Open Peek from there and tap Ping me']);
  await expect(sheet.getByRole('button', { name: 'Turn on' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Sign in for alerts on all your devices' })).toBeVisible();
  expect(await fits(phone)).toBe(true);
  expect(errors.get(phone)).toEqual([]);
  await context.close();
});

test('a parcel of the deliveries is shared through the same sheet: its link is made on copy, and stopped for good', async ({ page, context }) => {
  await allowCopying(page);
  await page.goto('/demo');
  await page.getByRole('button', { name: /New sneakers/ }).first().click();
  const detail = page.getByRole('dialog', { name: /New sneakers/ }).first();
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Share this parcel' }).click();
  const sheet = page.getByRole('dialog', { name: /^Share “New sneakers/ });
  await expect(sheet.getByText('The link is made when you share or copy it.')).toBeVisible();
  await expect(sheet.getByText('The same page anyone gets from Peek’s front door. Your alerts, notes and account stay yours.')).toBeVisible();
  await expect(sheet.getByText('Off, others see “DHL parcel”')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Stop sharing' })).toHaveCount(0);
  await sheet.getByRole('switch', { name: 'Show its name' }).check();
  await sheet.getByRole('button', { name: 'Copy' }).click();
  await expect(sheet.getByText('Link copied')).toBeVisible();
  const link = await copied(page);
  expect(link).toMatch(/\/p\/[2-9A-HJ-NP-Za-km-z]{12}#n=New%20sneakers/);
  await expect(sheet.getByRole('button', { name: 'Stop sharing' })).toBeVisible();

  // Anyone with the link gets the page a looked-up parcel has, as a viewer.
  const visitor = await context.newPage();
  watch(visitor);
  await visitor.goto(link);
  await expect(visitor.getByText('Shared with you · no account needed')).toBeVisible();
  await expect(status(visitor)).toHaveText('Ready for pickup');
  await expect(visitor.locator('.peekp-card__name')).toHaveText(/^New sneakers/);
  await expect(visitor.getByText('••• 99', { exact: true })).toBeVisible();
  // A link from an account is never forgotten by itself, and nobody can forget it from outside.
  await expect(visitor.getByText(/Peek forgets this parcel/)).toHaveCount(0);
  await expect(visitor.getByRole('button', { name: 'Forget it now' })).toHaveCount(0);

  await sheet.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(sheet.getByText('Sharing is stopped. Sharing again makes a new link.')).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { level: 1, name: 'This parcel isn’t shared anymore' })).toBeVisible();
  expect(errors.get(visitor)).toEqual([]);
});

test('fits a phone at 320 px, in German and in the dark: the sheets, a gift and the stopped page', async ({ page, browser }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await answerNotifications(page, 'granted');
  await page.addInitScript(() => localStorage.setItem('deliveryTrackerLocale', 'de'));
  await track(page, 'DEMOCHOC20260001', { field: 'Sendungsnummer oder Link', track: 'Verfolgen' });
  await expect(status(page)).toHaveText('In Zustellung');
  expect(await fits(page)).toBe(true);
  const address = page.url();

  await actions(page).getByRole('button', { name: 'Teilen', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Dieses Paket teilen' });
  await share.getByRole('switch', { name: 'Es ist ein Geschenk' }).check();
  await expect(share.getByRole('textbox', { name: 'Von' })).toBeVisible();
  expect(await fits(page)).toBe(true);
  // Nothing in the sheet is wider than the sheet.
  expect(await share.evaluate((sheet) => sheet.scrollWidth <= sheet.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');

  await actions(page).getByRole('button', { name: /^Sag mir Bescheid/ }).click();
  const alerts = page.getByRole('dialog', { name: 'Sag mir Bescheid, wenn es ankommt' });
  await expect(alerts.getByRole('button', { name: 'Einschalten' })).toBeVisible();
  expect(await fits(page)).toBe(true);
  expect(await alerts.evaluate((sheet) => sheet.scrollWidth <= sheet.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');

  const { context, page: recipient } = await anotherBrowser(browser, { viewport: { width: 320, height: 700 }, colorScheme: 'dark' });
  await recipient.addInitScript(() => localStorage.setItem('deliveryTrackerLocale', 'de'));
  await show(page, recipient, address);
  await expect(status(recipient)).toHaveText('Etwas ist auf dem Weg zu dir');
  expect(await fits(recipient)).toBe(true);
  await actions(page).getByRole('button', { name: 'Teilen', exact: true }).click();
  await share.getByRole('button', { name: 'Teilen beenden' }).click();
  await expect(share.getByText('Das Teilen ist beendet. Der Link zeigt anderen nichts mehr.')).toBeVisible();
  await show(page, recipient, address);
  await expect(recipient.getByRole('heading', { level: 1, name: 'Dieses Paket wird nicht mehr geteilt' })).toBeVisible();
  expect(await fits(recipient)).toBe(true);
  expect(errors.get(recipient)).toEqual([]);
  await context.close();
});

test('the sheets keep still under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await track(page, 'DEMOGLS20260009');
  await expect(status(page)).toHaveText('In transit');
  const running = () => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running'
    && Number(animation.effect?.getComputedTiming().duration) > 1).length);
  const sheet = await openShare(page);
  await sheet.getByRole('switch', { name: 'Show the tracking number' }).check();
  expect(await running()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});
