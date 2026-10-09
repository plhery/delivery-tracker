import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { documentLanguage } from '../src/lib/locale';

// What a search engine or a link preview gets: the first answer of the server, before any script runs.
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

/** A page as a crawler asks for it: no cookie, and no language unless one is given. */
async function firstByte(request: APIRequestContext, address: string, headers: Record<string, string> = {}) {
  const response = await request.get(address, { headers, maxRedirects: 0 });
  return { response, html: await response.text() };
}
const tag = (html: string, pattern: RegExp) => pattern.exec(html)?.[1]?.replaceAll('&amp;', '&') ?? null;
const languages = ['de', 'fr', 'it', 'es', 'pt', 'pl'] as const;
const questions: Record<string, string> = {
  de: 'Wo ist mein Paket?', fr: 'Où est mon colis\u202f?', it: 'Dov’è il mio pacco?',
  es: '¿Dónde está mi paquete?', pt: 'Onde está a minha encomenda?', pl: 'Gdzie jest moja paczka?',
};
/** What Peek is, as each language's title ends. */
const taglines: Record<string, string> = {
  en: 'Universal Package & Parcel Tracker', de: 'Universelle Paketverfolgung', fr: 'Suivi de colis universel', it: 'Tracciamento pacchi universale',
  es: 'Seguimiento universal de paquetes', pt: 'Seguimento universal de encomendas', pl: 'Uniwersalne śledzenie przesyłek',
};
/** The landing's title in a language: the question it answers, then what Peek is. */
const titleIn = (language: string) => `Peek — ${language === 'en' ? 'Where’s my parcel?' : questions[language]} ${taglines[language]}`;
/** The landing in every language as its addresses name them: each language's address, and `/` for a reader of none. */
const everyLanguage = (origin: string, root = `${origin}/`) => [
  ['en', root], ...languages.map((language) => [language, `${origin}/${language}`]), ['x-default', root],
];
const alternatesOf = (html: string) => [...html.matchAll(/<link rel="alternate" hrefLang="([^"]*)" href="([^"]*)"/g)].map(([, language, address]) => [language, address]);
const robotsOf = (html: string) => tag(html, /<meta name="robots" content="([^"]*)"/);
const canonicalOf = (html: string) => tag(html, /<link rel="canonical" href="([^"]*)"/);
const structuredDataOf = (html: string) => tag(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);

test('robots.txt lets everything be fetched and names the sitemap by its whole address', async ({ request, baseURL }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/plain');
  const lines = (await response.text()).split('\n').map((line) => line.trim()).filter(Boolean);
  expect(lines).toEqual(['User-Agent: *', 'Allow: /', `Sitemap: ${baseURL}/sitemap.xml`]);
});

test('sitemap.xml lists the landing and the guides in every language and the privacy notice, dating only the guides', async ({ request, baseURL }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/xml');
  const xml = await response.text();
  const addresses = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
  const landings = [`${baseURL}/`, ...languages.map((language) => `${baseURL}/${language}`)];
  expect(addresses.slice(0, landings.length)).toEqual(landings);
  expect(addresses.at(-1)).toBe(`${baseURL}/privacy.html`);
  // Between them, the guides: their own page in every language, then each guide in every language.
  const guides = addresses.slice(landings.length, -1);
  expect(guides.slice(0, 7)).toEqual([`${baseURL}/guides`, ...languages.map((language) => `${baseURL}/${language}/guides`)]);
  expect(guides.length % 7).toBe(0);
  for (const address of guides) expect(new URL(address).pathname).toMatch(/^(?:\/(?:de|fr|it|es|pt|pl))?\/guides(?:\/[a-z0-9-]+)?$/);
  const entries = xml.split('<url>').slice(1);
  const alternates = (entry: string) => [...entry.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)" \/>/g)].map(([, language, address]) => [language, address]);
  // Each landing names all of them, itself included, and claims no date nobody recorded.
  for (const entry of entries.slice(0, landings.length)) {
    expect(alternates(entry)).toEqual(everyLanguage(baseURL!));
    expect(entry).not.toContain('<lastmod>');
  }
  // Each guides page names itself in every language, and English for a reader of none, dated by the day it was checked.
  for (const entry of entries.slice(landings.length, -1)) {
    const named = Object.fromEntries(alternates(entry));
    expect(Object.keys(named)).toEqual(['en', ...languages, 'x-default']);
    expect(named['x-default']).toBe(named.en);
    expect(Object.values(named)).toContain(/<loc>([^<]*)<\/loc>/.exec(entry)![1]);
    expect(entry).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  }
  expect(entries.at(-1)).not.toContain('xhtml:link');
  expect(entries.at(-1)).not.toContain('<lastmod>');
  // Every address in it answers.
  for (const address of addresses) expect((await request.get(address)).status(), address).toBe(200);
});

test('the demo, the sample and the offline page stay out of search results, with their links followed', async ({ request, baseURL }) => {
  for (const address of ['/demo', '/sample', '/~offline']) {
    const { response, html } = await firstByte(request, address);
    expect(response.status(), address).toBe(200);
    expect(robotsOf(html), address).toBe('noindex, follow');
  }
  // The sample keeps its own preview: a parcel's picture under the sample's address.
  const { html } = await firstByte(request, '/sample');
  expect(canonicalOf(html)).toBe(`${baseURL}/sample`);
  expect(html).toMatch(new RegExp(`<meta property="og:image" content="${baseURL}/api/public/parcels/sample/image\\?lang=en"`));
  // The landing is meant to be found.
  expect(robotsOf((await firstByte(request, '/')).html)).toBeNull();
});

test('the landing tells search engines about the site and the app, as data the browser accepts', async ({ page, request, baseURL }) => {
  for (const address of ['/', '/home']) {
    const { html } = await firstByte(request, address);
    const text = structuredDataOf(html);
    expect(text, address).not.toBeNull();
    const data = JSON.parse(text!) as { '@context': string; '@graph': Record<string, unknown>[] };
    expect(data['@context']).toBe('https://schema.org');
    const [site, app] = data['@graph'];
    expect(site).toMatchObject({ '@type': 'WebSite', name: 'Peek', alternateName: ['Peek Tracker', new URL(baseURL!).hostname], url: `${baseURL}/` });
    expect(app).toMatchObject({ '@type': 'WebApplication', name: 'Peek', url: `${baseURL}/`, inLanguage: 'en', isAccessibleForFree: true });
    expect(app.description).toBe(tag(html, /<meta name="description" content="([^"]*)"/));
    // The landing's own address names `/` as the page.
    expect(canonicalOf(html), address).toBe(baseURL);
  }

  // In a browser, under the page's script policy: the block is there, parses, and nothing is reported.
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (directive: string) => { violations.push(directive); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      void (window as unknown as { reportViolation(directive: string): Promise<void> }).reportViolation(event.violatedDirective);
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  const blocks = page.locator('script[type="application/ld+json"]');
  await expect(blocks).toHaveCount(1);
  expect(JSON.parse((await blocks.textContent())!)['@graph']).toHaveLength(2);
  expect(violations).toEqual([]);
});

test('each language has an address whose first answer is entirely in that language', async ({ request, baseURL }) => {
  for (const language of languages) {
    // Whatever the browser prefers, and whatever language was chosen on another visit.
    for (const headers of [{ 'accept-language': 'en-GB,en;q=0.9' }, { 'accept-language': 'en-GB,en;q=0.9', cookie: 'sdt.locale=fr' }, {}]) {
      const { response, html } = await firstByte(request, `/${language}`, headers);
      const where = `/${language} ${JSON.stringify(headers)}`;
      expect(response.status(), where).toBe(200);
      // Nothing is chosen for the browser by a visit.
      expect(response.headers()['set-cookie'], where).toBeUndefined();
      // The address and hreflang say `pt`; the page says its Portuguese is European.
      expect(tag(html, /<html lang="([^"]*)"/), where).toBe(documentLanguage(language));
      expect(tag(html, /<title>([^<]*)<\/title>/), where).toBe(titleIn(language));
      expect(tag(html, /<h1[^>]*>([^<]*)<\/h1>/), where).toBe(questions[language]);
      expect(canonicalOf(html), where).toBe(`${baseURL}/${language}`);
      expect(alternatesOf(html), where).toEqual(everyLanguage(baseURL!, baseURL));
      expect(robotsOf(html), where).toBeNull();
      const description = tag(html, /<meta name="description" content="([^"]*)"/)!;
      expect(description, where).toMatch(/3.?500/);
      expect(description, where).not.toContain('Track any package');
      expect(tag(html, /<meta property="og:title" content="([^"]*)"/), where).toBe(titleIn(language));
      expect(tag(html, /<meta property="og:description" content="([^"]*)"/), where).toBe(description);
      expect(tag(html, /<meta property="og:url" content="([^"]*)"/), where).toBe(`${baseURL}/${language}`);
      expect(tag(html, /<meta property="og:locale" content="([^"]*)"/), where).toMatch(new RegExp(`^${language}_[A-Z]{2}$`));
      // The words of the page are in the language too, down to its last section.
      expect(html, where).not.toContain('Who’s behind Peek?');
      const [, app] = JSON.parse(structuredDataOf(html)!)['@graph'];
      expect(app, where).toMatchObject({ url: `${baseURL}/${language}`, inLanguage: language, description });
    }
  }

  // `/` is the landing for a reader of no language in particular: English to a crawler, and it names every language's address.
  const { html } = await firstByte(request, '/');
  expect(tag(html, /<html lang="([^"]*)"/)).toBe('en');
  expect(alternatesOf(html)).toEqual(everyLanguage(baseURL!, baseURL));
  expect(tag(html, /<meta property="og:locale" content="([^"]*)"/)).toBe('en_US');
  // To a person it stays in their language, title and description included.
  const german = (await firstByte(request, '/', { 'accept-language': 'de-CH,de;q=0.9' })).html;
  expect(tag(german, /<title>([^<]*)<\/title>/)).toBe(titleIn('de'));
  expect(canonicalOf(german)).toBe(baseURL);
});

test('English has no address of its own: `/en` leads to `/` for good', async ({ request }) => {
  const response = await request.get('/en?utm_source=test', { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe('/?utm_source=test');
});

test('a language address stays in its language in a browser that chose another, and saves nothing of the visit', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('deliveryTrackerLocale', 'fr'));
  await page.goto('/de');
  await expect(page.getByRole('heading', { level: 1, name: 'Wo ist mein Paket?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeEnabled();
  // The page is live, and still German from its head to its foot.
  await expect(page).toHaveTitle(titleIn('de'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('heading', { level: 2, name: 'Wer steckt hinter Peek?' })).toBeAttached();
  await expect(page.getByRole('contentinfo').getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');
  // The choice made before is still French, for `/` and every other address.
  expect(await page.evaluate(() => localStorage.getItem('deliveryTrackerLocale'))).toBe('fr');
  expect((await context.cookies()).filter((cookie) => cookie.name === 'sdt.locale').map((cookie) => cookie.value)).toEqual(['fr']);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Où est mon colis\u202f?' })).toBeVisible();
});

test('the language menu of a language address moves the address with the language, in place', async ({ page, context }) => {
  await page.goto('/de');
  await expect(page.getByRole('heading', { level: 1, name: 'Wo ist mein Paket?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeEnabled();
  // A visit chose nothing.
  expect(await page.evaluate(() => localStorage.getItem('deliveryTrackerLocale'))).toBeNull();
  expect((await context.cookies()).some((cookie) => cookie.name === 'sdt.locale')).toBe(false);
  await page.evaluate(() => { (window as unknown as { __loaded: boolean }).__loaded = true; });
  const steps = await page.evaluate(() => history.length);

  await page.getByRole('contentinfo').getByRole('combobox', { name: 'Sprache' }).selectOption('fr');
  await expect(page.getByRole('heading', { level: 1, name: 'Où est mon colis\u202f?' })).toBeVisible();
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page).toHaveTitle(titleIn('fr'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  expect(await page.evaluate(() => localStorage.getItem('deliveryTrackerLocale'))).toBe('fr');

  await page.getByRole('contentinfo').getByRole('combobox', { name: 'Langue' }).selectOption('en');
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page).toHaveTitle(titleIn('en'));
  expect(await page.evaluate(() => localStorage.getItem('deliveryTrackerLocale'))).toBe('en');
  expect((await context.cookies()).filter((cookie) => cookie.name === 'sdt.locale').map((cookie) => cookie.value)).toEqual(['en']);
  // The page never loaded again, and Back leaves it as before.
  expect(await page.evaluate(() => (window as unknown as { __loaded?: boolean }).__loaded)).toBe(true);
  expect(await page.evaluate(() => history.length)).toBe(steps);

  // `/` is no language's address: the menu changes the words there, as before, and the address stays.
  await page.getByRole('contentinfo').getByRole('combobox', { name: 'Language' }).selectOption('it');
  await expect(page.getByRole('heading', { level: 1, name: 'Dov’è il mio pacco?' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('a language address is the landing’s own: a lookup opens the parcel in that language, and Back returns', async ({ page }) => {
  await page.goto('/de');
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeEnabled();
  const field = page.getByRole('textbox', { name: 'Sendungsnummer oder Link' });
  await field.fill('1ZDEMO202600000001');
  await field.press('Enter');
  await expect(page).toHaveURL(/\/p\/[2-9A-HJ-NP-Za-km-z]{12}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Unterwegs' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Wo ist mein Paket?' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/de');
});

test('the service worker answers a language address from the server, never from the app shell it keeps for `/`', async ({ page }) => {
  test.skip(!process.env.CI && !process.env.PLAYWRIGHT_PRODUCTION, 'Requires the production service worker.');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // The worker is in charge: what it hands the browser for `/de` is the German page the server wrote.
  const html = await page.evaluate(async () => (await fetch('/de', { headers: { accept: 'text/html' } })).text());
  expect(html).toContain('<html lang="de"');
  const response = await page.goto('/de');
  expect(response!.fromServiceWorker()).toBe(true);
  expect(await response!.text()).toContain('<html lang="de"');
  await expect(page.getByRole('heading', { level: 1, name: 'Wo ist mein Paket?' })).toBeVisible();

  // The share target is still the worker's own: it keeps the shared text and sends the app to `/` to read it.
  const shared = await page.evaluate(async () => {
    const form = new FormData();
    form.set('title', 'Order');
    form.set('text', 'Tracking 1ZDEMO202600000001');
    const answer = await fetch('/share-target', { method: 'POST', body: form, redirect: 'manual' });
    const draft = await (await fetch('/share-target/draft', { cache: 'no-store' })).json() as { label: string; trackingInput: string };
    return { type: answer.type, draft };
  });
  expect(shared).toEqual({ type: 'opaqueredirect', draft: { label: 'Order', trackingInput: 'Tracking 1ZDEMO202600000001' } });
});

test('`/favicon.ico` answers with an icon', async ({ request }) => {
  const response = await request.get('/favicon.ico');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/image\/(x-icon|vnd\.microsoft\.icon)/);
  const icon = await response.body();
  // An icon file holding three images.
  expect([icon.readUInt16LE(0), icon.readUInt16LE(2), icon.readUInt16LE(4)]).toEqual([0, 1, 3]);
});

test('a path nothing lives at answers 404 with the page that says so', async ({ request }) => {
  const notFound = (title: string) => `<h1 id="feedback-title">${title}</h1>`;
  for (const address of ['/xx', '/share-target', '/home/nothing', '/robots', '/DE', '/de/more', '/deu', '/de.html',
    '/guides/no-such-guide', '/guides/no/such-guide', '/en/guides', '/nl/guides']) {
    const { response, html } = await firstByte(request, address);
    expect(response.status(), address).toBe(404);
    expect(html, address).toContain(notFound('This page isn’t here.'));
    expect(robotsOf(html), address).toBe('noindex');
  }
  // Under a language's guides, a slug without a guide says so in that language, and so does a guide's slug in other letters.
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const paths = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, address]) => new URL(address).pathname);
  const slugIn = (guides: string) => paths.find((path) => path.startsWith(`${guides}/`))!.slice(guides.length + 1);
  const [english, french] = [slugIn('/guides'), slugIn('/fr/guides')];
  for (const [address, title] of [['/fr/guides/no-such-guide', 'Cette page est introuvable.'], ['/pl/guides/no/such-guide', 'Nie znaleziono tej strony.'],
    [`/guides/${english.toUpperCase()}`, 'This page isn’t here.'], [`/fr/guides/${french.toUpperCase()}`, 'Cette page est introuvable.']]) {
    const { response, html } = await firstByte(request, address);
    expect(response.status(), address).toBe(404);
    expect(html, address).toContain(notFound(title));
    expect(robotsOf(html), address).toBe('noindex');
  }
});
