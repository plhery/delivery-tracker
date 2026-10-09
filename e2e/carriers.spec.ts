import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import en from '../shared/locales/en.json' with { type: 'json' };
import italian from '../shared/locales/it.json' with { type: 'json' };
import { CARRIER_LINKS } from '../src/generated/carriers';
import { documentLanguage } from '../src/lib/locale';

// The demo build keeps lookups in the browser; every number here is fictional.
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'] as const;
type Language = (typeof LANGUAGES)[number];
const NUMBER = '1ZDEMO202600000001';
const parcelAddress = /\/p\/[2-9A-HJ-NP-Za-km-z]{12}$/;
const pathOf = (address: string) => new URL(address).pathname;
const hub = (language: Language) => (language === 'en' ? '/carriers' : `/${language}/carriers`);

/** The pages the sitemap lists, each with its translations. */
async function sitemap(request: APIRequestContext) {
  const xml = await (await request.get('/sitemap.xml')).text();
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, entry]) => ({
    url: /<loc>([^<]+)<\/loc>/.exec(entry)![1],
    languages: Object.fromEntries([...entry.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map(([, language, href]) => [language, href])),
  }));
}
/** The carriers' pages the sitemap lists in a language, in its order. */
const pagesIn = (pages: Awaited<ReturnType<typeof sitemap>>, language: Language) =>
  pages.filter(({ url }) => pathOf(url).startsWith(`${hub(language)}/`));

/** Every element of the page that reaches past the sides of the screen. A table scrolls inside its own frame. */
const overflowing = (page: Page) => page.evaluate(() => {
  const width = document.documentElement.clientWidth;
  return [...document.querySelectorAll<HTMLElement>('.guide-page *')].filter((element) => {
    if (element.closest('.guide-table table, svg')) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (box.right > width + .5 || box.left < -.5);
  }).map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
});

/** Every address the tab is taken to, and every address it asks for, from now on. */
function addressesOf(page: Page) {
  const seen: string[] = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) seen.push(frame.url()); });
  page.on('request', (request) => seen.push(request.url()));
  return seen;
}

test('the carriers’ own page lists every carrier’s page of its language, and leads to them', async ({ page, request }) => {
  const pages = await sitemap(request);
  for (const language of LANGUAGES) {
    const response = await page.goto(hub(language));
    expect(response!.status(), language).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', documentLanguage(language));
    const cards = page.locator('.carrier-card');
    expect(await cards.evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href)), language).toEqual(pagesIn(pages, language).map(({ url }) => url));
  }
  await page.goto('/carriers');
  await expect(page.getByRole('heading', { level: 1, name: en['carriers.heading'] })).toBeVisible();
  expect(await overflowing(page)).toEqual([]);
  const [first] = CARRIER_LINKS.en;
  await page.locator('.carrier-card').first().click();
  await expect(page.getByRole('heading', { level: 1, name: first.title })).toBeVisible();
  await expect(page).toHaveTitle(`${first.title} — Peek`);
  // The guides lead here too.
  await page.goto('/guides');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: en['carriers.all'] })).toHaveAttribute('href', '/carriers');
});

test('a carrier’s page shows its title, the tracker and whose it is not, and names only the languages it is written in', async ({ page, request }) => {
  const pages = await sitemap(request);
  // A carrier written in some languages and not in others.
  const carrier = CARRIER_LINKS.en.find(({ id }) => LANGUAGES.some((language) => !CARRIER_LINKS[language].some((link) => link.id === id)))!;
  const english = pages.find(({ url }) => pathOf(url) === `/carriers/${carrier.slug}`)!;
  const written = LANGUAGES.filter((language) => language in english.languages);
  expect(written.length).toBeLessThan(LANGUAGES.length);
  expect(Object.keys(english.languages)).toEqual([...written, 'x-default']);

  const html = await (await request.get(pathOf(english.url), { headers: { 'accept-language': 'de' } })).text();
  expect(html).toMatch(/<html[^>]* lang="en"/);
  expect(html).toContain(`<link rel="canonical" href="${english.url}"/>`);
  const alternates = [...html.matchAll(/<link rel="alternate" hrefLang="([^"]+)" href="([^"]+)"\/>/g)].map(([, language, href]) => [language, href]);
  expect(alternates).toEqual(Object.entries(english.languages));
  expect(html).toContain('<meta property="og:type" content="article"/>');
  expect(html).toContain('"@type":"FAQPage"');

  await page.goto(pathOf(english.url));
  await expect(page.getByRole('heading', { level: 1, name: carrier.title })).toBeVisible();
  const field = page.getByRole('textbox', { name: `Track a ${carrier.name} parcel` });
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute('placeholder', en['add.trackingPlaceholder']);
  await expect(page.getByText(`Peek is an independent tracker, not ${carrier.name}.`)).toBeVisible();
  // The tracker stands above the text.
  expect(await field.evaluate((element) => element.compareDocumentPosition(document.querySelector('.guide-lead')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(page.locator('.guide__picture')).toHaveCount(0);
  expect(await overflowing(page)).toEqual([]);
  // At the foot, every language: the carrier's own page where it is written, the carriers' own page elsewhere.
  const languages = page.getByRole('contentinfo').getByRole('navigation', { name: 'Language' });
  expect(await languages.getByRole('link').evaluateAll((links) => links.map((link) => [link.getAttribute('hreflang'), (link as HTMLAnchorElement).href]))).toEqual(
    LANGUAGES.map((language) => [language, english.languages[language] ?? new URL(hub(language), english.url).href]),
  );
});

test('a slug without a carrier’s page, or a carrier in a language it is not written in, is the site’s 404 page', async ({ page, request }) => {
  // A carrier written in some languages and not in others, whose slug in another language is not its English one.
  const translatedSlug = (id: string, slug: string) => (language: Language) =>
    language !== 'en' && CARRIER_LINKS[language].some((link) => link.id === id && link.slug !== slug);
  const carrier = CARRIER_LINKS.en.find(({ id, slug }) => LANGUAGES.some((language) => !CARRIER_LINKS[language].some((link) => link.id === id))
    && LANGUAGES.some(translatedSlug(id, slug)))!;
  const missing = LANGUAGES.find((language) => !CARRIER_LINKS[language].some((link) => link.id === carrier.id))!;
  const translated = LANGUAGES.find(translatedSlug(carrier.id, carrier.slug))!;
  const slugIn = (language: Language) => CARRIER_LINKS[language].find((link) => link.id === carrier.id)!.slug;
  for (const address of ['/carriers/no-such-carrier', '/de/carriers/no-such-carrier', '/en/carriers', '/en/carriers/x', '/nl/carriers',
    `/carriers/${carrier.slug.toUpperCase()}`, `/carriers/${carrier.slug}/more`, `/${missing}/carriers/${carrier.slug}`,
    `/carriers/${slugIn(translated)}`, `/${missing}/carriers/${slugIn(translated)}`]) {
    expect((await request.get(address)).status(), address).toBe(404);
  }
  for (const language of LANGUAGES) expect((await request.get(hub(language))).status(), language).toBe(200);

  // In a browser, it is the 404 page in the address's language, at the address it was asked at.
  const response = await page.goto(`/it/carriers/no-such-carrier`);
  expect(response!.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: italian['web.notFoundTitle'] })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  expect(page.url()).toMatch(/\/it\/carriers\/no-such-carrier$/);
  // The browser reports the page's own 404 status as an error: that is the answer asked for.
  errors.set(page, errors.get(page)!.filter((error) => !/status of 404/.test(error)));
});

test('the tracker takes a number to the landing, which looks it up at once, and no address ever holds it', async ({ page, baseURL }) => {
  const [carrier] = CARRIER_LINKS.en;
  await page.goto(`/carriers/${carrier.slug}`);
  const seen = addressesOf(page);
  // An empty box goes nowhere.
  const button = page.locator('.carrier-tracker').getByRole('button', { name: en['sample.yours.action'] });
  await button.click();
  await expect(page.getByRole('textbox', { name: `Track a ${carrier.name} parcel` })).toBeFocused();
  expect(pathOf(page.url())).toBe(`/carriers/${carrier.slug}`);

  await page.getByRole('textbox', { name: `Track a ${carrier.name} parcel` }).fill(`  ${NUMBER} `);
  await button.click();
  // The landing opens, takes the number as if pasted, and the carrier being certain, opens its parcel.
  await expect(page).toHaveURL(parcelAddress);
  await expect(page.getByText(NUMBER, { exact: true }).first()).toBeVisible();
  expect(seen).toContain(`${baseURL}/home`);
  expect(seen.filter((address) => address.includes(NUMBER) || address.includes('1ZDEMO'))).toEqual([]);
  // The note was taken once: the landing opened again starts empty.
  expect(await page.evaluate(() => sessionStorage.getItem('sdt.peek.carrierHandoff.v1'))).toBeNull();
});

test('a message with several numbers waits on the landing of the page’s language, in its field, for a choice', async ({ page }) => {
  const carrier = CARRIER_LINKS.it[0];
  await page.goto(`/it/carriers/${carrier.slug}`);
  const seen = addressesOf(page);
  const message = `Il tuo ordine è partito:\nUPS ${NUMBER}\nSwiss Post 99.34.123456.78901234`;
  const field = page.getByRole('textbox', { name: italian['carriers.track.label'].replace('{{carrier}}', carrier.name) });
  await field.fill(message);
  await field.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  // The landing read it as pasted: it lists the numbers it found, and waits.
  await expect(page.getByRole('group', { name: '2 numeri di tracciamento in questo testo' }).getByRole('radio')).toHaveCount(2);
  expect(pathOf(page.url())).toBe('/it');
  await expect(page.locator('#door-tracking')).toHaveValue(message);
  expect(seen.filter((address) => address.includes('1ZDEMO') || address.includes('99.34'))).toEqual([]);
});

test('without a script, the tracker opens the landing and sends nothing typed', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  const [carrier] = CARRIER_LINKS.en;
  await page.goto(`/carriers/${carrier.slug}`);
  await page.getByRole('textbox', { name: `Track a ${carrier.name} parcel` }).fill(NUMBER);
  await Promise.all([page.waitForURL((url) => url.pathname === '/home'), page.locator('.carrier-tracker').getByRole('button').click()]);
  expect(page.url()).not.toContain('1ZDEMO');
  expect(new URL(page.url()).search).toMatch(/^\??$/);
  await context.close();
});
