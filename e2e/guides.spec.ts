import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import en from '../shared/locales/en.json' with { type: 'json' };
import fr from '../shared/locales/fr.json' with { type: 'json' };
import pl from '../shared/locales/pl.json' with { type: 'json' };

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'];
const path = (page: Page) => new URL(page.url()).pathname;
const pathOf = (address: string) => new URL(address).pathname;

/** The pages the sitemap lists, each with its translations. */
async function sitemap(request: APIRequestContext) {
  const xml = await (await request.get('/sitemap.xml')).text();
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, entry]) => ({
    url: /<loc>([^<]+)<\/loc>/.exec(entry)![1],
    languages: Object.fromEntries([...entry.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map(([, language, href]) => [language, href])),
  }));
}

/** Every element of the page that reaches past the sides of the screen. A table scrolls inside its own frame. */
const overflowing = (page: Page) => page.evaluate(() => {
  const width = document.documentElement.clientWidth;
  return [...document.querySelectorAll<HTMLElement>('.guide-page *')].filter((element) => {
    if (element.closest('.guide-table table, svg')) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (box.right > width + .5 || box.left < -.5);
  }).map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
});

test('the landing’s foot lists the guides out of sight, opens the list in place, and leads to a guide', async ({ page, request }) => {
  // A search engine reads every guide's address on the landing, before any script runs.
  const html = await (await request.get('/', { headers: { 'accept-language': 'en' } })).text();
  const listed = [...html.matchAll(/<li><a href="(\/guides\/[^"]+)"/g)].map(([, href]) => href);
  const guides = (await sitemap(request)).filter(({ url }) => /^\/guides\/./.test(pathOf(url))).map(({ url }) => pathOf(url));
  expect(listed).toEqual(guides);
  // So does it at a language's own address, in that language.
  const french = await (await request.get('/fr', { headers: { 'accept-language': 'en' } })).text();
  expect([...french.matchAll(/<li><a href="(\/fr\/guides\/[^"]+)"/g)]).toHaveLength(guides.length);

  await page.goto('/');
  const foot = page.locator('.landing-footer');
  const link = foot.getByRole('link', { name: 'Guides', exact: true });
  // The list is named by its heading, and the link says whether it is open.
  const list = page.getByRole('dialog', { name: en['guides.heading'] });
  await expect(list).toBeHidden();
  await expect(link).toHaveAttribute('aria-expanded', 'false');
  await link.click();
  await expect(list).toBeVisible();
  await expect(link).toHaveAttribute('aria-expanded', 'true');
  expect(path(page)).toBe('/');
  await expect(list.getByRole('listitem')).toHaveCount(listed.length);
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(link).toHaveAttribute('aria-expanded', 'false');

  await link.click();
  const first = list.getByRole('listitem').first().getByRole('link');
  const title = (await first.textContent())!;
  await first.click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  expect(path(page)).toBe(listed[0]);
  await expect(page).toHaveTitle(`${title} — Peek`);
  await expect(page.locator('.guide__picture > svg')).toBeVisible();
  expect(await overflowing(page)).toEqual([]);

  // The guide leads back to the tracker.
  await page.getByRole('banner').getByRole('link', { name: 'Track your parcel' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
});

test('a guide is written in the language of its address, whatever the browser sent, and names its translations', async ({ page, request }) => {
  const pages = await sitemap(request);
  const guide = pages.find(({ url }) => /\/fr\/guides\/./.test(url))!;
  // The browser asks for German, or has chosen English or German; the address says French.
  for (const headers of [{ 'accept-language': 'de-CH,de;q=0.9' }, { cookie: 'sdt.locale=en', 'accept-language': 'de' }, { cookie: 'sdt.locale=fr' }]) {
    const response = await request.get(pathOf(guide.url), { headers });
    expect(response.status()).toBe(200);
    // The browser's own choice is left as it was.
    expect(response.headers()['set-cookie']).toBeUndefined();
    const html = await response.text();
    expect(html).toMatch(/<html[^>]* lang="fr"/);
    expect(html).toContain(`<link rel="canonical" href="${guide.url}"/>`);
    for (const language of [...LANGUAGES, 'x-default']) {
      expect(html).toMatch(new RegExp(`<link rel="alternate" hrefLang="${language}" href="${guide.languages[language]}"/>`, 'i'));
    }
    expect(html).toContain('<meta property="og:type" content="article"/>');
    expect(html).toContain('<meta property="og:locale" content="fr_FR"/>');
    expect(html).toContain('"@type":"Article"');
  }
  expect(guide.languages['x-default']).toBe(guide.languages.en);
  // English has no prefix, and is English for a French reader too.
  expect(await (await request.get(pathOf(guide.languages.en), { headers: { cookie: 'sdt.locale=fr', 'accept-language': 'fr' } })).text()).toMatch(/<html[^>]* lang="en"/);

  // French takes its narrow spaces; at the foot, the same guide in every language, each a plain link.
  await page.context().addCookies([{ name: 'sdt.locale', value: 'de', url: guide.url }]);
  await page.goto(pathOf(guide.url));
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  // Read as it is written: a matcher of text would take the narrow space for a plain one.
  expect(await page.locator('.guide-cta strong').textContent()).toBe(fr['guides.cta.title']);
  expect(await page.locator('main').evaluate((main) => {
    const copy = main.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('code, script').forEach((element) => element.remove());
    return copy.textContent!.match(/ [?!;:»]|« /g);
  })).toBeNull();
  const languages = page.getByRole('contentinfo').getByRole('navigation', { name: 'Langue' });
  await expect(languages.getByRole('link')).toHaveCount(LANGUAGES.length);
  await languages.getByRole('link', { name: 'Polski' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  expect(page.url()).toBe(guide.languages.pl);
  await expect(page.getByRole('link', { name: 'Wszystkie poradniki' })).toHaveAttribute('href', '/pl/guides');
  expect(await overflowing(page)).toEqual([]);
  // Reading a guide chose no language for the browser.
  expect((await page.context().cookies()).find(({ name }) => name === 'sdt.locale')?.value).toBe('de');

  // The tracker is the landing in the guide's language.
  await page.getByRole('banner').getByRole('link', { name: 'Śledź swoją paczkę' }).click();
  expect(path(page)).toBe('/pl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
});

test('the guides’ own page shows a card for every guide, and its pages answer', async ({ page, request }) => {
  const pages = await sitemap(request);
  const guides = pages.filter(({ url }) => /^\/guides\/./.test(pathOf(url)));
  await page.goto('/guides');
  await expect(page.getByRole('heading', { level: 1, name: 'Parcel tracking, explained' })).toBeVisible();
  const cards = page.locator('.guide-card');
  await expect(cards).toHaveCount(guides.length);
  expect(await cards.evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))).toEqual(guides.map(({ url }) => url));
  expect(await overflowing(page)).toEqual([]);
  // The guides' own page in every language answers; English has no prefix, and a slug without a guide is no page.
  const indexes = pages.filter(({ url }) => /\/guides$/.test(url));
  expect(indexes.map(({ url }) => pathOf(url))).toEqual(LANGUAGES.map((language) => (language === 'en' ? '/guides' : `/${language}/guides`)));
  for (const { url } of indexes) expect((await request.get(pathOf(url))).status(), url).toBe(200);
  for (const missing of ['/en/guides', '/en/guides/x', '/nl/guides', '/guides/no-such-guide', '/pl/guides/no-such-guide']) {
    expect((await request.get(missing)).status(), missing).toBe(404);
  }

  // In a browser, a slug without a guide is the site's 404 page in the address's language, at the address it was asked at.
  const missing = await page.goto('/pl/guides/no-such-guide');
  expect(missing!.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: pl['web.notFoundTitle'] })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  expect(page.url()).toMatch(/\/pl\/guides\/no-such-guide$/);
  // The browser reports the page's own 404 status as an error: that is the answer asked for.
  errors.set(page, errors.get(page)!.filter((error) => !/status of 404/.test(error)));
});

test('the number formats guide names a number’s carrier as it is typed, and tracks it on the landing without an address holding it', async ({ page, baseURL }) => {
  const { GUIDE_LINKS } = await import('../src/generated/guides');
  const { CARRIER_LINKS } = await import('../src/generated/carriers');
  const guide = GUIDE_LINKS.en.find(({ id }) => id === 'tracking-number-formats')!;
  await page.goto(`/guides/${guide.slug}`);
  const seen: string[] = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) seen.push(frame.url()); });
  page.on('request', (request) => seen.push(request.url()));
  const field = page.getByRole('textbox', { name: en['guides.checker.label'] });
  await expect(field).toHaveAccessibleDescription(en['guides.checker.hint']);
  const result = page.locator('#number-checker-result');
  await field.fill('YT1234567890123456');
  const yunexpress = CARRIER_LINKS.en.find(({ id }) => id === 'yunexpress')!;
  await expect(result.getByRole('link', { name: 'YunExpress' })).toHaveAttribute('href', `/carriers/${yunexpress.slug}`);
  await expect(result).toContainText(en['add.detectedCarrier']);
  await field.fill('12345');
  await expect(result).toContainText(en['guides.checker.none']);
  expect(await overflowing(page)).toEqual([]);

  await field.fill('1ZDEMO202600000001');
  await field.press('Enter');
  // The landing takes it as if pasted, and the carrier being certain, opens its parcel.
  await expect(page).toHaveURL(/\/p\/[2-9A-HJ-NP-Za-km-z]{12}$/);
  expect(seen).toContain(`${baseURL}/home`);
  expect(seen.filter((address) => address.includes('1ZDEMO') || address.includes('YT123') || address.includes('12345'))).toEqual([]);
});

test('a translated number formats guide checks numbers in its own language, on a phone too', async ({ page }) => {
  const { GUIDE_LINKS } = await import('../src/generated/guides');
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto(`/pl/guides/${GUIDE_LINKS.pl.find(({ id }) => id === 'tracking-number-formats')!.slug}`);
  const field = page.getByRole('textbox', { name: pl['guides.checker.label'] });
  await field.fill('CNG12345678900000');
  const result = page.locator('#number-checker-result');
  await expect(result.getByRole('link', { name: 'Cainiao' })).toHaveAttribute('href', /^\/pl\/carriers\//);
  await expect(result).toContainText(pl['guides.checker.maybeNote']);
  expect(await overflowing(page)).toEqual([]);
  await field.fill('');
  await page.getByRole('button', { name: pl['sample.yours.action'] }).click();
  await expect(field).toBeFocused();
  expect(new URL(page.url()).pathname).toMatch(/^\/pl\/guides\//);
});
