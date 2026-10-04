import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

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
const tag = (html: string, pattern: RegExp) => pattern.exec(html)?.[1] ?? null;
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

test('sitemap.xml lists the pages meant to be found, without dates nobody recorded', async ({ request, baseURL }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/xml');
  const xml = await response.text();
  const addresses = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
  expect(addresses).toEqual([`${baseURL}/`, `${baseURL}/privacy.html`]);
  expect(xml).not.toContain('<lastmod>');
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

test('`/favicon.ico` answers with an icon', async ({ request }) => {
  const response = await request.get('/favicon.ico');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/image\/(x-icon|vnd\.microsoft\.icon)/);
  const icon = await response.body();
  // An icon file holding three images.
  expect([icon.readUInt16LE(0), icon.readUInt16LE(2), icon.readUInt16LE(4)]).toEqual([0, 1, 3]);
});

test('a path nothing lives at answers 404 with the page that says so', async ({ request }) => {
  for (const address of ['/xx', '/share-target', '/home/nothing', '/robots']) {
    const { response, html } = await firstByte(request, address);
    expect(response.status(), address).toBe(404);
    expect(html, address).toContain('This page isn’t here.');
    expect(robotsOf(html), address).toBe('noindex');
  }
});
