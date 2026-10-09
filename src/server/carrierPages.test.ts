import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../shared/locales/en.json';
import fr from '../../shared/locales/fr.json';
import { SUPPORTED_LOCALES, type Locale } from '../lib/locale';

const request = vi.hoisted(() => ({ host: 'peek.example' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ host: request.host, 'x-forwarded-proto': 'https' }),
}));
// Outside a request there is nothing to wait for.
vi.mock('next/server', async (original) => ({ ...await original<typeof import('next/server')>(), connection: async () => undefined }));

const { carrierAddresses, carrierAlternates, carrierLanguages, carrierLinkBySlug, carrierLinks, carrierText } = await import('./carrierTexts');
const { CarrierIndexRoute, CarrierRoute, carrierIndexMetadata, carrierMetadata } = await import('./carrierPages');
const { frenchSpacing, questions } = await import('../guides/markdown');

afterEach(() => { request.host = 'peek.example'; vi.unstubAllEnvs(); });

const [first] = carrierLinks('en');
const prefix = (locale: Locale) => (locale === 'en' ? '' : `/${locale}`);
/** A carrier written in English and in one other language, and a language it is not written in. */
const translated = carrierLinks('en').map(({ id }) => ({ id, languages: carrierLanguages(id) })).find(({ languages }) => languages.length > 1 && languages.length < SUPPORTED_LOCALES.length)!;
const [, other] = translated.languages;
const missing = SUPPORTED_LOCALES.find((locale) => !translated.languages.includes(locale))!;
const graph = (html: string) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1])['@graph'];

describe('the carriers’ pages as the server reads them', () => {
  it('has each carrier’s page in its languages only, each file under the address and title the app links', () => {
    expect(first).toBeDefined();
    expect(translated).toBeDefined();
    for (const locale of SUPPORTED_LOCALES) {
      for (const link of carrierLinks(locale)) {
        const text = carrierText(locale, link.id);
        expect({ slug: text.slug, title: text.title }).toEqual({ slug: link.slug, title: link.title });
        expect(text).not.toHaveProperty('picture');
        expect(carrierLinkBySlug(locale, link.slug)).toBe(link);
        expect(carrierLanguages(link.id)).toContain(locale);
      }
    }
    expect(carrierLanguages(first.id)[0]).toBe('en');
    expect(carrierLinkBySlug('en', 'no-such-carrier')).toBeUndefined();
    // A slug of one language names nothing in another.
    expect(carrierLinkBySlug(missing, carrierLinks('en')[0].slug)).toBeUndefined();
  });

  it('reads a page’s file every time while developing, so an edit shows, and once in production', () => {
    expect(carrierText('en', first.id)).not.toBe(carrierText('en', first.id));
    vi.stubEnv('NODE_ENV', 'production');
    const kept = carrierText('en', first.id);
    expect(carrierText('en', first.id)).toBe(kept);
  });

  it('leads a carrier’s page in every language to its own page where it is written, and to the carriers’ own page elsewhere', () => {
    expect(carrierAddresses()).toEqual({ en: '/carriers', de: '/de/carriers', fr: '/fr/carriers', it: '/it/carriers', es: '/es/carriers', pt: '/pt/carriers', pl: '/pl/carriers' });
    const addresses = carrierAddresses(translated.id);
    for (const locale of SUPPORTED_LOCALES) {
      const own = carrierLinks(locale).find(({ id }) => id === translated.id);
      expect(addresses[locale], locale).toBe(`${prefix(locale)}/carriers${own ? `/${own.slug}` : ''}`);
    }
    expect(addresses[missing]).toBe(`${prefix(missing)}/carriers`);
  });

  it('tells search engines a carrier’s page in its own languages only, and the carriers’ own page in all', () => {
    const origin = new URL('https://peek.example');
    const addresses = carrierAddresses(translated.id);
    expect(carrierAlternates(origin, translated.id)).toEqual({
      ...Object.fromEntries(translated.languages.map((locale) => [locale, `https://peek.example${addresses[locale]}`])),
      'x-default': `https://peek.example${addresses.en}`,
    });
    expect(carrierAlternates(origin, translated.id)).not.toHaveProperty(missing);
    expect(carrierAlternates(origin)).toEqual({
      ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, `https://peek.example${prefix(locale)}/carriers`])),
      'x-default': 'https://peek.example/carriers',
    });
  });
});

describe('what a carrier’s page tells a search engine', () => {
  it('names the page itself as the one to index, and the same page in its other languages, on the canonical origin', async () => {
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
    const link = carrierLinks(other).find(({ id }) => id === translated.id)!;
    const text = carrierText(other, link.id);
    const metadata = await carrierMetadata(other, link.slug);
    const address = (locale: Locale) => `https://peek.example.test${carrierAddresses(link.id)[locale]}`;
    expect(metadata.title).toBe(`${link.title} — Peek`);
    expect(metadata.description).toBe(text.description);
    expect(metadata.metadataBase).toEqual(new URL('https://peek.example'));
    expect(metadata.alternates).toEqual({
      canonical: address(other),
      languages: { ...Object.fromEntries(translated.languages.map((locale) => [locale, address(locale)])), 'x-default': address('en') },
    });
    expect(metadata.openGraph).toMatchObject({
      type: 'article', url: address(other), siteName: 'Peek', title: text.title,
      publishedTime: text.published, modifiedTime: text.updated,
      images: [{ url: expect.stringMatching(new RegExp(`^https://peek\\.example/og${other === 'en' ? '' : `-${other}`}\\.png\\?v=`)), width: 1200, height: 630 }],
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: text.title });
  });

  it('keeps every title short enough for a search result', () => {
    for (const locale of SUPPORTED_LOCALES) for (const { title } of carrierLinks(locale)) expect(title.length).toBeLessThanOrEqual(60);
  });

  it('does the same for the carriers’ own page, in every language', async () => {
    const metadata = await carrierIndexMetadata('fr');
    expect(metadata.title).toBe(`${frenchSpacing(fr['carriers.heading'])} — Peek`);
    expect(metadata.alternates).toMatchObject({ canonical: 'https://peek.example/fr/carriers', languages: { pl: 'https://peek.example/pl/carriers', 'x-default': 'https://peek.example/carriers' } });
    expect(metadata.openGraph).toMatchObject({ type: 'website', locale: 'fr_FR' });
  });

  it('has no page for a carrier that does not exist, nor for one in a language it is not written in', async () => {
    // Metadata is resolved outside the page's not-found boundary: it must not throw.
    expect(await carrierMetadata('en', 'no-such-carrier')).toEqual({});
    await expect(CarrierRoute({ locale: 'en', slug: 'no-such-carrier' })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
    const english = carrierLinks('en').find(({ id }) => id === translated.id)!;
    expect(await carrierMetadata(missing, english.slug)).toEqual({});
    await expect(CarrierRoute({ locale: missing, slug: english.slug })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it('writes the page with what it is, where it sits and the questions it answers, as plain words', async () => {
    const html = renderToStaticMarkup(await CarrierRoute({ locale: 'en', slug: first.slug }));
    const [article, crumbs, faq] = graph(html);
    const url = `https://peek.example/carriers/${first.slug}`;
    expect(article).toMatchObject({ '@type': 'Article', headline: first.title, inLanguage: 'en', mainEntityOfPage: url });
    expect(crumbs.itemListElement.map((item: { name: string; item: string }) => [item.name, item.item])).toEqual([
      ['Peek', 'https://peek.example/'], [en['carriers.title'], 'https://peek.example/carriers'], [first.title, url],
    ]);
    const asked = questions(carrierText('en', first.id).blocks);
    expect(faq).toMatchObject({ '@type': 'FAQPage', inLanguage: 'en', url });
    expect(faq.mainEntity.map((entry: { name: string }) => entry.name)).toEqual(asked.map(({ question }) => question));
    expect(faq.mainEntity).toHaveLength(asked.length);
    for (const entry of faq.mainEntity) {
      expect(entry).toMatchObject({ '@type': 'Question', acceptedAnswer: { '@type': 'Answer' } });
      expect(entry.acceptedAnswer.text.length).toBeGreaterThan(20);
      // Words only: neither the Markdown's marks nor the page's elements.
      expect(entry.acceptedAnswer.text).not.toMatch(/[<>*`]|\]\(/);
    }
    // Nothing in the data can close its element.
    expect(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]).not.toMatch(/[<>&]/);
    expect(html).toContain(renderToStaticMarkup(createElement('h1', null, first.title)));
  });

  it('puts the tracker under the title, says whose it is not, and leads to the other carriers of its language', async () => {
    const html = renderToStaticMarkup(await CarrierRoute({ locale: 'en', slug: first.slug }));
    expect(html).toContain(`Track a ${first.name} parcel`);
    expect(html).toContain(`Peek is an independent tracker, not ${first.name}.`);
    // The field has no name: the form sends nothing to the landing's address.
    const form = /<form class="carrier-tracker"[^>]*>[\s\S]*?<\/form>/.exec(html)![0];
    expect(form).toContain('action="/home"');
    expect(form).not.toMatch(/\sname="/);
    expect(html.indexOf('carrier-tracker')).toBeLessThan(html.indexOf('guide-lead'));
    const others = [...html.matchAll(/class="guide-card carrier-card" href="([^"]+)"/g)].map(([, href]) => href);
    expect(others).toEqual(carrierLinks('en').filter(({ id }) => id !== first.id).map(({ slug }) => `/carriers/${slug}`));
    // Its language links lead to its own page where it is written, to the carriers' own page elsewhere.
    expect(html).toContain(`href="${carrierAddresses(first.id)[missing]}" hrefLang="${missing}"`);
  });

  it('starts a carrier’s trail at the landing in the page’s language', async () => {
    const link = carrierLinks(other).find(({ id }) => id === translated.id)!;
    const [, crumbs] = graph(renderToStaticMarkup(await CarrierRoute({ locale: other, slug: link.slug })));
    expect(crumbs.itemListElement.map((item: { item: string }) => item.item)).toEqual([
      `https://peek.example/${other}`, `https://peek.example/${other}/carriers`, `https://peek.example/${other}/carriers/${link.slug}`,
    ]);
  });

  it('writes the carriers’ own page with a card for each carrier of its language, and with none in a language that has none', async () => {
    const html = renderToStaticMarkup(await CarrierIndexRoute({ locale: other }));
    expect([...html.matchAll(/class="guide-card carrier-card" href="([^"]+)"/g)].map(([, href]) => href)).toEqual(carrierLinks(other).map(({ slug }) => `/${other}/carriers/${slug}`));
    expect(html).toContain('hrefLang="pl"');
    for (const locale of SUPPORTED_LOCALES.filter((language) => carrierLinks(language).length === 0)) {
      const empty = renderToStaticMarkup(await CarrierIndexRoute({ locale }));
      expect(empty).not.toContain('carrier-card');
      expect(empty).toContain('<h1');
    }
  });

  it('sets a French page’s words as French is set, its code aside', async () => {
    const pages = [
      renderToStaticMarkup(await CarrierIndexRoute({ locale: 'fr' })),
      ...await Promise.all(carrierLinks('fr').map(async ({ slug }) => renderToStaticMarkup(await CarrierRoute({ locale: 'fr', slug })))),
    ];
    for (const html of pages) {
      const words = html.replace(/<script[\s\S]*?<\/script>|<code>[\s\S]*?<\/code>|<[^>]+>/g, '');
      expect(words).not.toMatch(/ [?!;:»]|« /);
    }
    expect(pages[0]).toContain(frenchSpacing(fr['carriers.lead']));
  });
});
