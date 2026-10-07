import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
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
const NARROW = String.fromCharCode(0x202f);
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
  expect(await page.locator('.guide-cta strong').textContent()).toBe(fr['guides.cta.title'].replace(/ (?=[?!;:»])/g, NARROW).replace(/« /g, `«${NARROW}`));
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
