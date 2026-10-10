import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Metadata } from 'next';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ language: 'en' }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({
    host: 'delivery.example.test',
    'x-forwarded-proto': 'https',
    'accept-language': request.language,
  })),
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
// Outside a request there is nothing to wait for.
vi.mock('next/server', async (original) => ({ ...await original<typeof import('next/server')>(), connection: async () => undefined }));

import { generateMetadata as demoMetadata } from '../app/demo/page';
import { generateMetadata as layoutMetadata } from '../app/layout';
import { GET as englishManifest } from '../app/manifest.webmanifest/route';
import LandingAddressPage, { generateMetadata as landingAddressMetadata } from '../app/home/page';
import HomePage, { generateMetadata } from '../app/page';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { metadata as offlineMetadata } from '../app/~offline/page';
import mark from './brand/mark.json';
import { carrierPath } from './carriers/paths';
import { CARRIER_LINKS } from './generated/carriers';
import { GUIDE_LINKS } from './generated/guides';
import { guidePath } from './guides/paths';
import { ADDRESS_LANGUAGES, documentLanguage, SUPPORTED_LOCALES, type Locale } from './lib/locale';
import { messagesFor } from './server/requestLocale';

const TITLE = 'Peek — Universal Parcel Tracker';
const DESCRIPTION =
  'Private parcel tracking, with notifications and history synced across your devices.';
const LANDING_TITLE = 'Peek — Where’s my parcel? Universal Package & Parcel Tracker';
const LANDING_DESCRIPTION =
  'Track any package or parcel: paste a tracking number, a carrier link or a shipping email. 3,500+ carriers, checked every 10 minutes. Open source, no account needed.';
/** The page of a language's address, as the router finds it. */
const languagePage = (language: string) => import(`../app/${language}/page.tsx`) as Promise<{ default: () => ReactElement; generateMetadata: () => Promise<Metadata> }>;
/** The landing in every language, as each of its addresses names them. */
const alternates = (origin: string) => ({
  en: `${origin}/`, de: `${origin}/de`, fr: `${origin}/fr`, it: `${origin}/it`, es: `${origin}/es`, pt: `${origin}/pt`, pl: `${origin}/pl`,
  'x-default': `${origin}/`,
});

afterEach(() => { vi.unstubAllEnvs(); });

/** The data block a landing page starts with, as a crawler reads it. */
async function structuredData(page: ReactElement | Promise<ReactElement>) {
  const landing = await page;
  // A page hands its work to the landing's own server component.
  const rendered = await (landing.type as (props: unknown) => Promise<ReactElement<{ children: ReactElement[] }>>)(landing.props);
  const [script, application] = rendered.props.children;
  expect(isValidElement(application)).toBe(true);
  const { type, dangerouslySetInnerHTML } = script.props as { type: string; dangerouslySetInnerHTML: { __html: string } };
  expect(script.type).toBe('script');
  expect(type).toBe('application/ld+json');
  return { text: dangerouslySetInnerHTML.__html, application: application as ReactElement<Record<string, unknown>> };
}

describe('public product metadata', () => {
  it('names the site and the installed PWA Peek, with what it does where the name stands alone', async () => {
    expect(await layoutMetadata()).toMatchObject({
      applicationName: 'Peek',
      title: TITLE,
      description: DESCRIPTION,
      appleWebApp: { title: 'Peek' },
    });
    expect(await englishManifest().json()).toMatchObject({
      name: TITLE,
      short_name: 'Peek',
      description: DESCRIPTION,
      lang: 'en',
      id: '/',
      start_url: '/',
      scope: '/',
    });
    expect((await layoutMetadata()).manifest).toBe('/manifest.webmanifest');
    // A manifest file of Next's own convention would replace every page's link with its own.
    expect(readdirSync('app', { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.startsWith('manifest.'))).toEqual([]);
  });

  it.each(ADDRESS_LANGUAGES)('names and describes the installed app in %s to pages in that language, as the same app', async (language) => {
    const words = messagesFor(language);
    const { GET } = await import(`../app/${language}/manifest.webmanifest/route.ts`) as { GET: () => Response };
    const response = GET();
    expect(response.headers.get('content-type')).toBe('application/manifest+json');
    // Only the words and their language differ: installed from any language, it is one app.
    expect(await response.json()).toEqual({
      ...await englishManifest().json(),
      name: `Peek — ${words['app.tagline']}`,
      description: words['preview.site.description'],
      lang: documentLanguage(language),
    });
    // A browser fetches the manifest without cookies: the page names the one in its language.
    request.language = `${language},en;q=0.5`;
    expect((await layoutMetadata()).manifest).toBe(`/${language}/manifest.webmanifest`);
    request.language = 'en';
  });

  it('draws the browser tab with the mark on its rounded tile and the Home Screen with the full-bleed icon', async () => {
    expect((await layoutMetadata()).icons).toEqual({
      icon: { url: '/icons/favicon.svg', type: 'image/svg+xml' },
      apple: '/icons/apple-touch-icon.png',
    });
  });

  it('titles the landing with the question it answers, the same in canonical and social metadata', async () => {
    const metadata = await generateMetadata();
    expect(metadata).toMatchObject({
      metadataBase: new URL('https://delivery.example.test/'),
      title: LANDING_TITLE,
      description: LANDING_DESCRIPTION,
      alternates: { canonical: 'https://delivery.example.test/', languages: alternates('https://delivery.example.test') },
      openGraph: {
        siteName: 'Peek',
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
      },
      twitter: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
      },
    });
  });

  it('names `/` as the landing’s address at the landing’s own address too', async () => {
    expect(await landingAddressMetadata()).toEqual(await generateMetadata());
    expect((await landingAddressMetadata()).alternates?.canonical).toBe('https://delivery.example.test/');
  });

  it.each(ADDRESS_LANGUAGES)('writes the landing at /%s in that language, whatever the browser prefers, and names that address', async (language) => {
    request.language = 'en-GB,en;q=0.9';
    const words = messagesFor(language);
    const title = `Peek — ${words['peek.title']} ${words['preview.landing.tagline']}`;
    const description = words['preview.landing.description'];
    const address = `https://delivery.example.test/${language}`;
    const { default: LanguageLandingPage, generateMetadata: languageMetadata } = await languagePage(language);
    const metadata = await languageMetadata();
    expect(metadata).toMatchObject({
      title,
      description,
      alternates: { canonical: address, languages: alternates('https://delivery.example.test') },
      openGraph: { url: address, title, description, locale: expect.stringMatching(new RegExp(`^${language}_[A-Z]{2}$`)) },
      twitter: { title, description },
    });
    expect(metadata.robots).toBeUndefined();

    // The page itself: German words at the German address, shown to someone signed in too.
    const { text, application } = await structuredData(LanguageLandingPage());
    expect(JSON.parse(text)['@graph'][1]).toMatchObject({ url: address, inLanguage: language, description });
    expect(application.props).toMatchObject({ landingRoute: true, initialLocale: language, initialMessages: words });
  });

  it('names every language’s address, and `/` for a reader of none, at each of the landing’s addresses', async () => {
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
    const everywhere = alternates('https://peek.example.test');
    expect(Object.keys(everywhere)).toEqual([...SUPPORTED_LOCALES, 'x-default']);
    expect((await generateMetadata()).alternates).toEqual({ canonical: 'https://peek.example.test/', languages: everywhere });
    for (const language of ADDRESS_LANGUAGES) {
      expect((await (await languagePage(language)).generateMetadata()).alternates).toEqual({ canonical: `https://peek.example.test/${language}`, languages: everywhere });
    }
  });

  it('has a page for each language’s address and for nothing else that short: any other one-part address is no route at all', () => {
    // A route for any one-part address would answer an unknown one itself, with a page only the browser draws.
    const routes = readdirSync('app', { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(routes.filter((name) => name.includes('['))).toEqual([]);
    expect(routes.filter((name) => /^[a-z]{2}$/.test(name)).sort()).toEqual([...ADDRESS_LANGUAGES].sort());
    for (const language of ADDRESS_LANGUAGES) expect(existsSync(`app/${language}/page.tsx`), language).toBe(true);
    // English is at `/`: `/en` is a redirect, not a page.
    expect(existsSync('app/en')).toBe(false);
  });

  it('names the landing on the canonical origin when one is configured, whichever host answered', async () => {
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
    const metadata = await generateMetadata();
    expect(metadata.alternates?.canonical).toBe('https://peek.example.test/');
    expect(metadata.openGraph).toMatchObject({ url: 'https://peek.example.test/' });
    // What the page loads still comes from the host that answered.
    expect(metadata.metadataBase).toEqual(new URL('https://delivery.example.test/'));
  });

  it('tells search engines about the site and the app in a data block nothing can break out of', async () => {
    const { text, application } = await structuredData(HomePage());
    expect(text).not.toMatch(/[<>&]/);
    const data = JSON.parse(text) as { '@context': string; '@graph': Record<string, unknown>[] };
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@graph']).toEqual([
      { '@type': 'WebSite', name: 'Peek', alternateName: ['Peek Tracker', 'delivery.example.test'], url: 'https://delivery.example.test/', inLanguage: ['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'] },
      {
        '@type': 'WebApplication', name: 'Peek', alternateName: 'Peek — Universal Parcel Tracker', url: 'https://delivery.example.test/',
        description: LANDING_DESCRIPTION, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Web, iOS', inLanguage: 'en', isAccessibleForFree: true,
      },
    ]);
    expect(application.props).toMatchObject({ landingRoute: false, initialLocale: 'en' });

    // The landing's own address says the same, in the language it renders in.
    request.language = 'fr-CH,fr;q=0.9';
    const french = await structuredData(LandingAddressPage());
    expect(JSON.parse(french.text)['@graph'][1]).toMatchObject({ url: 'https://delivery.example.test/', inLanguage: 'fr', description: messagesFor('fr')['preview.landing.description'] });
    expect(french.application.props).toMatchObject({ landingRoute: true, initialLocale: 'fr' });
    request.language = 'en';
  });

  it('lets crawlers fetch everything, and names the sitemap by its whole address', async () => {
    expect(await robots()).toEqual({ rules: { userAgent: '*', allow: '/' }, sitemap: 'https://delivery.example.test/sitemap.xml' });
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
    expect(await robots()).toEqual({ rules: { userAgent: '*', allow: '/' }, sitemap: 'https://peek.example.test/sitemap.xml' });
  });

  it('lists the pages meant to be found, on the canonical origin when one is configured', async () => {
    const local = alternates('https://delivery.example.test');
    const here = await sitemap();
    expect(here.slice(0, SUPPORTED_LOCALES.length)).toEqual(SUPPORTED_LOCALES.map((locale) => ({ url: local[locale], alternates: { languages: local } })));
    expect(here.slice(-2)).toEqual([{ url: 'https://delivery.example.test/privacy.html' }, { url: 'https://delivery.example.test/support.html' }]);
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
    const origin = 'https://peek.example.test';
    const entries = await sitemap();
    /** The guides' page, or one guide, in every language and in English for a reader of none. */
    const guides = (id?: string) => {
      const address = (locale: Locale) => `${origin}${guidePath(locale, id && GUIDE_LINKS[locale].find((link) => link.id === id)!.slug)}`;
      return { ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, address(locale)])) as Record<Locale, string>, 'x-default': address('en') };
    };
    /** The carriers' own page in every language, or one carrier's page in each of its languages only; in English for a reader of none. */
    const carriers = (id?: string) => {
      const languages = id ? SUPPORTED_LOCALES.filter((locale) => CARRIER_LINKS[locale].some((link) => link.id === id)) : SUPPORTED_LOCALES;
      const address = (locale: Locale) => `${origin}${carrierPath(locale, id && CARRIER_LINKS[locale].find((link) => link.id === id)!.slug)}`;
      return { ...Object.fromEntries(languages.map((locale) => [locale, address(locale)])) as Partial<Record<Locale, string>>, 'x-default': address('en') };
    };
    const ids = GUIDE_LINKS.en.map(({ id }) => id);
    const carrierIds = CARRIER_LINKS.en.map(({ id }) => id);
    const carrierPages = carrierIds.flatMap((id) => SUPPORTED_LOCALES.filter((locale) => carriers(id)[locale]).map((locale) => ({ id, locale })));
    expect(entries.map(({ url }) => url)).toEqual([
      'https://peek.example.test/', 'https://peek.example.test/de', 'https://peek.example.test/fr', 'https://peek.example.test/it',
      'https://peek.example.test/es', 'https://peek.example.test/pt', 'https://peek.example.test/pl',
      ...SUPPORTED_LOCALES.map((locale) => guides()[locale]),
      ...ids.flatMap((id) => SUPPORTED_LOCALES.map((locale) => guides(id)[locale])),
      ...SUPPORTED_LOCALES.map((locale) => `${origin}${carrierPath(locale)}`),
      ...carrierPages.map(({ id, locale }) => carriers(id)[locale]),
      'https://peek.example.test/privacy.html',
      'https://peek.example.test/support.html',
    ]);
    const articlesEnd = 14 + ids.length * SUPPORTED_LOCALES.length;
    const [landings, indexes, articles] = [entries.slice(0, 7), entries.slice(7, 14), entries.slice(14, articlesEnd)];
    const [hubs, pages] = [entries.slice(articlesEnd, articlesEnd + 7), entries.slice(articlesEnd + 7, -2)];
    // Each language's landing names all of them, itself included, and `/` for a reader of none.
    for (const entry of landings) expect(entry.alternates?.languages).toEqual(alternates(origin));
    // No date is claimed for a page whose last change nobody recorded.
    for (const entry of [...landings, ...entries.slice(-2)]) expect(entry).not.toHaveProperty('lastModified');
    // A guide is dated by the day its facts were last checked, and its list by its newest guide.
    const updated = (id: string, locale: Locale) => /^updated: (\S+)$/m.exec(readFileSync(`content/guides/${id}/${locale}.md`, 'utf8'))![1];
    SUPPORTED_LOCALES.forEach((locale, at) => {
      expect(indexes[at].alternates?.languages).toEqual(guides());
      expect(indexes[at].lastModified).toBe(ids.map((id) => updated(id, locale)).sort().at(-1));
    });
    ids.forEach((id, guideAt) => SUPPORTED_LOCALES.forEach((locale, at) => {
      const entry = articles[guideAt * SUPPORTED_LOCALES.length + at];
      expect(entry.alternates?.languages).toEqual(guides(id));
      expect(entry.lastModified).toBe(updated(id, locale));
    }));
    // The carriers' own page names every language; a carrier's page only those it is written in, each dated as a guide is.
    const checked = (id: string, locale: Locale) => /^updated: (\S+)$/m.exec(readFileSync(`content/carriers/${id}/${locale}.md`, 'utf8'))![1];
    expect(carrierPages.length).toBeGreaterThan(carrierIds.length);
    SUPPORTED_LOCALES.forEach((locale, at) => {
      expect(hubs[at].alternates?.languages).toEqual(carriers());
      expect(hubs[at].lastModified).toBe(CARRIER_LINKS[locale].map(({ id }) => checked(id, locale)).sort().at(-1));
    });
    carrierPages.forEach(({ id, locale }, at) => {
      expect(pages[at].alternates?.languages).toEqual(carriers(id));
      expect(pages[at].lastModified).toBe(checked(id, locale));
    });
  });

  it('writes a sitemap that stays well-formed whatever host a request names', async () => {
    const { headers } = await import('next/headers');
    vi.mocked(headers).mockResolvedValueOnce(new Headers({ host: 'a&b"c.example.test', 'x-forwarded-proto': 'https' }));
    const entries = await sitemap();
    expect(entries[0].url).toBe('https://a&amp;b&quot;c.example.test/');
    for (const entry of entries) expect(JSON.stringify(entry)).not.toMatch(/&(?!amp;|quot;)|\\"c/);
  });

  it('keeps the demo and the offline page out of search results, with their links followed', async () => {
    expect((await demoMetadata()).robots).toEqual({ index: false, follow: true });
    expect(offlineMetadata.robots).toEqual({ index: false, follow: true });
  });

  it('answers `/favicon.ico` with the mark at the three sizes a browser asks for', () => {
    const icon = readFileSync('public/favicon.ico');
    expect([icon.readUInt16LE(0), icon.readUInt16LE(2), icon.readUInt16LE(4)]).toEqual([0, 1, 3]);
    const images = [0, 1, 2].map((index) => {
      const entry = 6 + 16 * index;
      const png = icon.subarray(icon.readUInt32LE(entry + 12), icon.readUInt32LE(entry + 12) + icon.readUInt32LE(entry + 8));
      // Each image is a PNG that says the same size as its entry.
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([icon.readUInt8(entry), icon.readUInt8(entry + 1)]);
      return icon.readUInt8(entry);
    });
    expect(images).toEqual([16, 32, 48]);
    expect(icon.length).toBe(6 + 16 * 3 + [0, 1, 2].reduce((sum, index) => sum + icon.readUInt32LE(6 + 16 * index + 8), 0));
  });

  it('links the preview image by its contents, so a redrawn image replaces cached copies', async () => {
    const { twitter } = await generateMetadata();
    const digest = createHash('sha256').update(readFileSync('public/og.png')).digest('hex').slice(0, 8);
    expect(twitter?.images).toEqual([`https://delivery.example.test/og.png?v=${digest}`]);
  });

  it('writes the landing and its picture in each of the reader’s languages', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      request.language = locale;
      const words = messagesFor(locale);
      const file = `og${locale === 'en' ? '' : `-${locale}`}.png`;
      const digest = createHash('sha256').update(readFileSync(`public/${file}`)).digest('hex').slice(0, 8);
      const metadata = await generateMetadata();
      expect(metadata.title).toBe(`Peek — ${words['peek.title']} ${words['preview.landing.tagline']}`);
      expect(metadata.description).toBe(words['preview.landing.description']);
      // Long enough to say what Peek does, short enough for a search result to show most of it.
      expect([...words['preview.landing.description']].length).toBeLessThanOrEqual(205);
      expect(metadata.twitter?.images).toEqual([`https://delivery.example.test/${file}?v=${digest}`]);
      expect((await layoutMetadata()).description).toBe(words['preview.site.description']);
    }
    request.language = 'en';
    expect(new Set(SUPPORTED_LOCALES.map((locale) => messagesFor(locale)['preview.landing.description'])).size).toBe(SUPPORTED_LOCALES.length);
  });

  it('gives a page that draws no preview of its own Peek’s picture, under the page’s own title', async () => {
    const { metadataBase, openGraph, twitter } = await layoutMetadata();
    const { twitter: landing } = await generateMetadata();
    expect(metadataBase).toEqual(new URL('https://delivery.example.test/'));
    expect(openGraph).toEqual({
      type: 'website',
      siteName: 'Peek',
      locale: 'en_US',
      images: [{ url: (landing?.images as string[])[0], width: 1_200, height: 630, alt: expect.stringContaining('Where’s my parcel?') }],
    });
    // Without a title or a description here, each page's own are shared.
    expect(twitter).toEqual({ card: 'summary_large_image', images: landing?.images });
  });

  it('names the demo and says where its parcels stay, in the reader’s language', async () => {
    expect(await demoMetadata()).toMatchObject({ title: 'Peek — Demo mode', description: 'These sample parcels stay on this device.' });
    request.language = 'de-CH,de;q=0.9';
    expect(await demoMetadata()).toMatchObject({ title: 'Peek — Demo-Modus', description: 'Diese Beispielpakete bleiben auf diesem Gerät.' });
    request.language = 'en';
  });

  it('signs the preview picture with the mark as it is drawn everywhere else', () => {
    const picture = readFileSync('public/og.svg', 'utf8');
    const { size, tile, shapes } = mark;
    expect(picture).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(picture).toContain(`<rect width="${size}" height="${size}" rx="${tile.radius}" fill="${tile.fill}"/>`);
    for (const { tag, ...attributes } of shapes) {
      expect(picture).toContain(`<${tag} ${Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(' ')}/>`);
    }
  });
});
