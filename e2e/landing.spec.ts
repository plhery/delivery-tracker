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
const pip = (page: Page) => page.getByRole('link', { name: 'Open a sample parcel' });
const journey = (page: Page) => page.getByRole('img', { name: 'A parcel’s journey, scan by scan' });
/** What the field shows itself with: the sample over the placeholder, or nothing. */
const sample = (page: Page) => page.locator('.door-sample[data-on] .door-sample__text');
/** The page of the sample parcel Pip opens. */
const samplePage = (page: Page) => page.getByText('Sample parcel', { exact: true });
const path = (page: Page) => new URL(page.url()).pathname;

async function openLanding(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
}

/** Every element that reaches past the sides of the screen. Drawings that are cut on purpose are left out. */
const overflowing = (page: Page) => page.evaluate(() => {
  const cut = '.door-ribbon__road, .door-nextup__map, .card-route, .landing-journey__map, .parcel-card__engraving, .sr-only, svg';
  const width = document.documentElement.clientWidth;
  return [...document.querySelectorAll<HTMLElement>('.door *')].filter((element) => {
    if (element.closest(cut)) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (box.right > width + .5 || box.left < -.5);
  }).map((element) => `${element.tagName.toLowerCase()}.${element.className} ${Math.round(element.getBoundingClientRect().right)}`);
});

/** How far the middle of an element's words, or of its own box, stands from the middle of the page. */
const offCentre = (page: Page, selector: string, box = false) => page.locator(selector).first().evaluate((element, own) => {
  const range = document.createRange();
  range.selectNodeContents(element);
  const { left, right } = own ? element.getBoundingClientRect() : range.getBoundingClientRect();
  return Math.abs((left + right) / 2 - document.documentElement.clientWidth / 2);
}, box);
/** The same for the passport's cover with the stamps it holds: the stamp a delivery adds lands beside them. */
const passportOffCentre = (page: Page) => page.locator('.landing-passport').evaluate((passport) => {
  const { left } = passport.querySelector('.landing-passport__cover')!.getBoundingClientRect();
  const held = passport.querySelectorAll('.landing-stamp:not(.landing-stamp--new)');
  const { right } = held[held.length - 1].getBoundingClientRect();
  return Math.abs((left + right) / 2 - document.documentElement.clientWidth / 2);
});

/** Records every layout shift from the first paint on, the way the browser reports them. */
async function watchLayout(page: Page) {
  await page.addInitScript(() => {
    const shifts: { value: number; at: number; input: boolean; what: string[] }[] = [];
    (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] })[]) {
        shifts.push({
          value: entry.value, at: Math.round(entry.startTime), input: entry.hadRecentInput,
          what: (entry.sources ?? []).map((source) => source.node instanceof Element ? `${source.node.tagName.toLowerCase()}.${source.node.className}` : String(source.node?.nodeName)),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
/** The shifts that count: after the first half second, and not an answer to something the visitor did. */
const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __shifts: { value: number; at: number; input: boolean; what: string[] }[] }).__shifts
  .filter((shift) => shift.at > 500 && !shift.input));

test('asks four questions in order, with the field first and the name, the code and the language at the foot', async ({ page, request }) => {
  // The page arrives with its words: nothing of it waits for the map or the sample parcels.
  const html = await (await request.get('/')).text();
  for (const text of ['Where’s my parcel?', 'Will I know when it moves?', 'Following more than one?', 'Who’s behind Peek?', 'parcel-illustration']) expect(html).toContain(text);
  expect(html).not.toContain('landing-journey__canvas');
  expect(html).not.toContain('parcel-card');
  expect(html).toContain('<title>Peek — Where’s my parcel? Universal Parcel Tracker</title>');

  await openLanding(page);
  await expect(page).toHaveTitle('Peek — Where’s my parcel? Universal Parcel Tracker');
  await expect(page.locator('.door h1, .door h2:not(.door-device h2)')).toHaveText([
    'Where’s my parcel?', 'Will I know when it moves?', 'Following more than one?', 'Who’s behind Peek?',
  ]);
  await expect(page.getByRole('link', { name: 'Open source 3,500+ carriers' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Works with Swiss Post, DHL, UPS, DPD Switzerland, GLS and thousands more carriers' })).toBeVisible();
  const moves = page.getByRole('region', { name: 'Will I know when it moves?' });
  await expect(moves.getByRole('listitem')).toHaveText(['Checked up to every 10 min', 'Up to every 2 min on the last mile']);

  // The heavy parts arrive when their sections come near: the journey on the app's own map, the list in the app's own cards.
  await journey(page).scrollIntoViewIfNeeded();
  await expect(journey(page).locator('g[data-kind="current"]')).toBeVisible();
  await expect(journey(page).locator('[data-pip]')).toBeVisible();
  const phone = page.locator('.landing-phone');
  await phone.scrollIntoViewIfNeeded();
  await expect(phone.locator('.parcel-card')).toHaveCount(3);
  await expect(phone.locator('.parcel-card--hero [data-scale]')).toHaveAttribute('data-scale', 'world');
  // A picture of the app: nothing in it can be used.
  await expect(phone.locator('.parcel-card').first()).toBeDisabled();
  await expect(page.getByRole('button', { name: /Kind of Blue/ })).toHaveCount(0);

  const who = page.getByRole('region', { name: 'Who’s behind Peek?' });
  await expect(who.getByRole('listitem')).toHaveCount(3);
  await expect(who.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/plhery/peek-delivery-tracker');
  await expect(who.getByRole('link', { name: '@plhery on X' })).toHaveAttribute('href', 'https://x.com/plhery');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy.html');
  await footer.getByRole('combobox', { name: 'Language' }).selectOption('de');
  await expect(page.getByRole('heading', { level: 2, name: 'Wer steckt hinter Peek?' })).toBeVisible();
  await expect(page).toHaveTitle('Peek — Wo ist mein Paket? Universelle Paketverfolgung');
});

test('the field shows what it takes until someone touches it, then never again', async ({ page }) => {
  await openLanding(page);
  // A number, a link, an email, each answered by its carrier. None of it is the field's value.
  await expect(sample(page)).toHaveText('1234567899');
  await expect(page.locator('.door-sample-line')).toHaveAttribute('data-phase', 'found');
  await expect(page.locator('.door-sample-line__found')).toHaveText('DHL has this parcel');
  await expect(page.locator('.door-pip')).toHaveAttribute('data-mood', 'happy');
  await expect(field(page)).toHaveValue('');
  await expect(page.locator('.door-sample')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.door-sample-line')).toHaveAttribute('aria-hidden', 'true');
  await expect(sample(page)).toHaveText('ups.com/track?tracknum=1ZDEMO202600000001', { timeout: 8_000 });
  await expect(page).toHaveURL(/\/$/);

  // Focus stops it for good, and clears the sample.
  await field(page).focus();
  await expect(sample(page)).toHaveCount(0);
  await expect(page.locator('.door-sample-line')).toHaveAttribute('data-phase', 'rest');
  await field(page).blur();
  await page.waitForTimeout(6_000);
  await expect(sample(page)).toHaveCount(0);
  await expect(field(page)).toHaveValue('');
});

test('a paste still tracks, whatever the field was showing', async ({ page }) => {
  await openLanding(page);
  await expect(sample(page)).toHaveText('1234567899');
  await field(page).focus();
  await field(page).evaluate((element, value) => {
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
    document.execCommand('insertText', false, value);
  }, 'Good news, your order has shipped!\nUPS tracking: 1ZDEMO202600000001');
  await expect(page).toHaveURL(parcelAddress);
  await expect(page.getByText('1ZDEMO202600000001', { exact: true }).first()).toBeVisible();
  // The sample's number was never looked up: the parcel is the pasted one.
  await expect(page.getByLabel('UPS', { exact: true }).first()).toBeVisible();

  // Back at the landing the parcel is on this device, right under the field and before everything else.
  await page.waitForTimeout(500);
  await page.goBack();
  const device = page.getByRole('region', { name: 'On this device' });
  await expect(device.getByRole('link')).toHaveCount(1);
  await expect(page.locator('.door')).toHaveAttribute('data-view', 'device');
  await expect(page.getByRole('link', { name: 'Open source 3,500+ carriers' })).toHaveCount(0);
  await expect(page.locator('.door-pip')).toHaveCount(0);
  expect(await device.evaluate((list) => Boolean(list.compareDocumentPosition(document.querySelector('.landing-moves')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByRole('heading', { level: 2, name: 'Will I know when it moves?' })).toBeVisible();
  // With parcels of its own, the field has nothing to show.
  await page.waitForTimeout(3_000);
  await expect(page.locator('.door-sample')).toHaveCount(0);
});

test('tapping Pip opens the box, then the sample parcel, and Back returns to the landing', async ({ page }) => {
  await openLanding(page);
  await expect(page.getByText('No number handy? Tap Pip to open a sample.')).toBeVisible();
  await pip(page).click();
  // The box opens first.
  await expect(page.locator('.door-pip')).toHaveClass(/door-pip--opening/);
  await expect(page.getByText('Opening a sample…')).toBeVisible();
  expect(path(page)).toBe('/');
  // Then one parcel on its own page, as a pasted number would open: not the deliveries of an account.
  await expect(samplePage(page)).toBeVisible();
  expect(path(page)).toBe('/sample');
  await expect(page.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
  await expect(page.locator('.peekp-card__name')).toHaveText('Moon lamp 🌙');
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  expect(path(page)).toBe('/');
  // Nothing was remembered: `/` is still the landing of a first visit.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  await expect(page.locator('.door')).toHaveAttribute('data-view', 'first');
});

test('the demo deliveries open from the section about following several parcels', async ({ page }) => {
  await openLanding(page);
  const demo = page.getByRole('link', { name: 'Try the demo' });
  await expect(demo).toHaveAttribute('href', '/demo');
  await demo.click();
  await expect(page.locator('.demo-banner')).toBeVisible();
  expect(path(page)).toBe('/demo');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  expect(path(page)).toBe('/');
});

test('everything that can be used is reached by keyboard, and Pip opens with Enter', async ({ page, browserName }) => {
  await openLanding(page);
  // Safari's Tab stops at fields and menus only, unless its "Press Tab to highlight each item"
  // setting is on; Option-Tab stops at everything, as Tab does in other browsers.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const reached: string[] = [];
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press(tab);
    const name = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return '';
      if (element.closest('.landing-phone, [aria-hidden="true"]')) return 'INSIDE A PICTURE';
      return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName;
    });
    if (name) reached.push(name);
  }
  expect(reached).not.toContain('INSIDE A PICTURE');
  for (const name of ['Sign in', 'Paste', 'Open a sample parcel', 'Sign in to keep them all', 'Try the demo', 'View on GitHub', '@plhery on X', 'Privacy', 'Language']) expect(reached).toContain(name);
  // The field comes before Pip, and Pip before what the page says below.
  expect(reached.indexOf('Paste')).toBeLessThan(reached.indexOf('Open a sample parcel'));
  expect(reached.indexOf('Open a sample parcel')).toBeLessThan(reached.indexOf('Sign in to keep them all'));

  await pip(page).focus();
  await page.keyboard.press('Enter');
  await expect(samplePage(page)).toBeVisible();
  expect(path(page)).toBe('/sample');
});

test('the journey plays only while its card is on screen', async ({ page }) => {
  await openLanding(page);
  const card = page.locator('.landing-journey__card');
  await expect(card).toHaveAttribute('data-scan', '0');
  // Out of sight for longer than a scan: it has not moved.
  await page.waitForTimeout(3_600);
  await expect(card).toHaveAttribute('data-scan', '0');
  await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(card).toHaveAttribute('data-scan', '1', { timeout: 5_000 });
  await expect(card.locator('.landing-stack [data-on] strong')).toHaveText('Cleared customs');
  await expect(page.locator('.landing-ping[data-on] strong')).toHaveText('Cleared customs');
  await expect(card.locator('path[data-kind="travelled"]')).toHaveCount(1);
  await expect(card.locator('[data-pip]')).toHaveAttribute('data-pip', 'wait');
  await expect(card).toHaveAttribute('data-scan', '2', { timeout: 5_000 });
  await expect(card.locator('[data-pip]')).toHaveAttribute('data-pip', 'eager');
  // Delivered: the box opens, the dot stops pulsing, and a stamp lands in the passport.
  await expect(card).toHaveAttribute('data-scan', '3', { timeout: 5_000 });
  await expect(card.locator('[data-pip]')).toHaveAttribute('data-pip', 'joy');
  await expect(card.locator('g[data-kind="current"] circle')).toHaveCount(1);
  await expect(page.locator('.landing-stamp--new')).toHaveAttribute('data-landed');
  // Off screen again, it holds the scan it is on.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const held = await card.getAttribute('data-scan');
  await page.waitForTimeout(3_600);
  await expect(card).toHaveAttribute('data-scan', held!);
});

test('shows still frames to someone who asked for less motion, and Pip still opens', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLanding(page);
  // The field shows its placeholder; nothing loops.
  await page.waitForTimeout(3_000);
  await expect(sample(page)).toHaveCount(0);
  await expect(field(page)).toHaveAttribute('placeholder', 'Paste a number, link, or message');
  // The journey shows the parcel on its last mile, with its route and its ping.
  const card = page.locator('.landing-journey__card');
  await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(card).toHaveAttribute('data-scan', '2');
  await expect(card.locator('.landing-stack [data-on] strong')).toHaveText('Out for delivery');
  await expect(card.locator('path[data-kind="travelled"]')).toHaveCount(2);
  await expect(page.locator('.landing-ping[data-on]')).toContainText('Out for delivery');
  await page.waitForTimeout(3_500);
  await expect(card).toHaveAttribute('data-scan', '2');
  await page.locator('.landing-phone').scrollIntoViewIfNeeded();
  await expect(page.locator('.landing-phone .parcel-card')).toHaveCount(3);
  const running = await page.evaluate(() => document.getAnimations().filter((animation) => {
    const timing = animation.effect?.getComputedTiming();
    return animation.playState === 'running' && Number(timing?.duration) > 1;
  }).length);
  expect(running).toBe(0);
  // Pip stands still, and still opens on tap.
  await page.evaluate(() => window.scrollTo(0, 0));
  await pip(page).click();
  await expect(samplePage(page)).toBeVisible();
});

test('fits a 320 px phone in every language, from the field to the foot of the page', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 700 });
  for (const [locale, question] of [
    ['en', 'Where’s my parcel?'], ['de', 'Wo ist mein Paket?'], ['fr', 'Où est mon colis\u202f?'], ['it', 'Dov’è il mio pacco?'],
    ['es', '¿Dónde está mi paquete?'], ['pt', 'Onde está a minha encomenda?'], ['pl', 'Gdzie jest moja paczka?'],
  ]) {
    // Chosen before the page loads: reloading a page that is still fetching makes WebKit log the cancelled requests.
    await page.addInitScript((value) => localStorage.setItem('deliveryTrackerLocale', value), locale);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: question })).toBeVisible();
    // Walk the page so the map and the cards are in place before measuring.
    await page.locator('.landing-journey').scrollIntoViewIfNeeded();
    await expect(page.locator('.landing-journey__card [data-pip]')).toBeVisible();
    await page.locator('.landing-phone').scrollIntoViewIfNeeded();
    await expect(page.locator('.landing-phone .parcel-card')).toHaveCount(3);
    await page.locator('.landing-footer').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), locale).toBe(true);
    expect(await overflowing(page), locale).toEqual([]);
  }
});

test('a section in one column stands on the page’s middle, and a tablet keeps the phone beside the words', async ({ page }) => {
  // A small window: one column, as wide as the journey's card, centred like the field above it.
  await page.setViewportSize({ width: 800, height: 900 });
  await openLanding(page);
  for (const selector of ['.landing-moves h2', '.landing-moves__text p', '.landing-chips', '.landing-journey__card', '.landing-more h2', '.landing-phone', '.landing-more__actions']) {
    expect(await offCentre(page, selector), selector).toBeLessThan(2);
  }
  expect(await passportOffCentre(page)).toBeLessThan(2);
  const card = (await page.locator('.landing-journey__card').boundingBox())!;
  for (const selector of ['.landing-phone', '.landing-benefits']) {
    const box = (await page.locator(selector).boundingBox())!;
    expect([Math.round(box.x), Math.round(box.width)], selector).toEqual([Math.round(card.x), Math.round(card.width)]);
  }

  // A tablet: the list stays in its phone, and what signing in adds stands beside it.
  await page.setViewportSize({ width: 820, height: 1180 });
  const phone = (await page.locator('.landing-phone').boundingBox())!;
  const words = (await page.locator('.landing-more__rest').boundingBox())!;
  expect(phone.x + phone.width).toBeLessThan(words.x);
  expect(words.y).toBeLessThan(phone.y + phone.height);
  // The passport's cover and its stamps keep to one row there.
  const cover = (await page.locator('.landing-passport__cover').boundingBox())!;
  const stamps = (await page.locator('.landing-passport__stamps').boundingBox())!;
  expect(stamps.x).toBeGreaterThan(cover.x + cover.width);
  expect(await overflowing(page)).toEqual([]);

  // A phone: the same middle, down to the card that says who is behind Peek, and buttons as wide as the column.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of ['.landing-moves h2', '.landing-more h2', '.landing-who h2', '.landing-who__facts strong', '.landing-who__links']) {
    expect(await offCentre(page, selector), selector).toBeLessThan(2);
  }
  // The stamps stand under the passport's cover there, the three it holds on its middle.
  for (const selector of ['.landing-passport__cover', '.landing-stamp:nth-child(2)', '.landing-who__icon']) {
    expect(await offCentre(page, selector, true), selector).toBeLessThan(2);
  }
  const column = (await page.locator('.landing-more__rest').boundingBox())!;
  const signIn = (await page.getByRole('button', { name: 'Sign in to keep them all' }).boundingBox())!;
  expect(Math.round(signIn.width)).toBe(Math.round(column.width));
});

test('nothing on the page moves another part of it: the layout holds while every loop runs', async ({ page }) => {
  test.setTimeout(120_000);
  await watchLayout(page);
  await openLanding(page);
  // Fifteen seconds at the top: three samples in the field, the carrier's line, Pip hopping, the ribbon rolling.
  await page.waitForTimeout(15_000);
  await expect(page.locator('.door-sample-line')).toBeAttached();
  expect(await shifts(page)).toEqual([]);

  // Then the journey: all four scans and the start of the next round, with the map and its pings arriving.
  await page.locator('.landing-journey__card').evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(13_500);
  expect(await shifts(page)).toEqual([]);

  // And the list, the passport and the foot of the page.
  await page.locator('.landing-phone').evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(page.locator('.landing-phone .parcel-card')).toHaveCount(3);
  await page.waitForTimeout(2_500);
  await page.locator('.landing-footer').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_000);
  const moved = await shifts(page);
  expect(moved).toEqual([]);
  expect(moved.reduce((sum, shift) => sum + shift.value, 0)).toBe(0);
});

test('a browser that has the demo open is never shown the landing on its way there', async ({ page }) => {
  // What the page looked like in every frame from its first paint on.
  await page.addInitScript(() => {
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    const seen = { landing: false };
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    const look = () => {
      const door = document.querySelector('.door');
      if (door && door.getClientRects().length > 0) seen.landing = true;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.goto('/');
  await expect(page.locator('.demo-banner')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __seen: { landing: boolean } }).__seen.landing)).toBe(false);
  // The mark that kept it out of sight is gone once the page knows what to show.
  expect(await page.evaluate(() => document.documentElement.dataset.entry)).toBeUndefined();
  await page.getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
});

test('the sign-in step lasts a reload of its tab, and the next visit opens the landing again', async ({ page, context }) => {
  await openLanding(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // A new tab shares the browser's storage with the one left at sign-in, not the tab's own.
  const later = await context.newPage();
  await openLanding(later);
  expect(await later.evaluate(() => document.documentElement.dataset.entry)).toBeUndefined();
  await later.close();
});

test('the landing has an address of its own, and the deliveries end on a foot that leads to it', async ({ page }) => {
  // This browser has the demo open: `/` shows the demo deliveries.
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.dataset.entry)).toBeUndefined();
  await page.goto('/');
  await expect(page.locator('.demo-banner')).toBeVisible();
  const foot = page.locator('.app-foot');
  await foot.scrollIntoViewIfNeeded();
  await expect(foot).toContainText('Peek · Universal Parcel Tracker');
  await expect(foot.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy.html');
  // Without an account the landing is at `/`: the link leaves the demo for it.
  await foot.getByRole('link', { name: 'Home page' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  expect(path(page)).toBe('/');
  // The landing opens at its top, not as far down as the foot stood.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the foot of the deliveries fits a 320 px phone in every language', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 700 });
  for (const [locale, home] of [
    ['en', 'Home page'], ['de', 'Startseite'], ['fr', 'Page d’accueil'], ['it', 'Pagina iniziale'],
    ['es', 'Página de inicio'], ['pt', 'Página inicial'], ['pl', 'Strona główna'],
  ]) {
    await page.addInitScript((value) => localStorage.setItem('deliveryTrackerLocale', value), locale);
    await page.goto('/demo');
    const foot = page.locator('.app-foot');
    await foot.scrollIntoViewIfNeeded();
    await expect(foot.getByRole('link', { name: home })).toBeVisible();
    const sides = await foot.evaluate((element) => [...element.children].map((child) => child.getBoundingClientRect()).map(({ left, right }) => [Math.floor(left), Math.ceil(right)]));
    for (const [left, right] of sides) {
      expect(left, locale).toBeGreaterThanOrEqual(0);
      expect(right, locale).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), locale).toBe(true);
  }
});

test('a visitor with parcels on this device never sees the first visit’s screen before their own', async ({ page }) => {
  await openLanding(page);
  await field(page).fill('1ZDEMO202600000001');
  await field(page).press('Enter');
  await expect(page).toHaveURL(parcelAddress);
  await page.waitForTimeout(500);
  await page.addInitScript(() => {
    const seen = { firstVisit: false };
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    const look = () => {
      // What only a first visit shows: the line under the title, Pip's hint.
      for (const element of document.querySelectorAll<HTMLElement>('.door-lead, .door-hint, .door-pill')) {
        if (element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible') seen.firstVisit = true;
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await watchLayout(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'On this device' }).getByRole('link')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2, name: 'Will I know when it moves?' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __seen: { firstVisit: boolean } }).__seen.firstVisit)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.dataset.entry)).toBeUndefined();
  await page.waitForTimeout(1_500);
  expect(await shifts(page)).toEqual([]);
});
