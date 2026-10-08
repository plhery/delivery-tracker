import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import de from '../../shared/locales/de.json';
import fr from '../../shared/locales/fr.json';
import { SUPPORTED_LOCALES, type Locale } from '../lib/locale';

const request = vi.hoisted(() => ({ host: 'peek.example' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ host: request.host, 'x-forwarded-proto': 'https' }),
}));
// Outside a request there is nothing to wait for.
vi.mock('next/server', async (original) => ({ ...await original<typeof import('next/server')>(), connection: async () => undefined }));

const { guide, guideAddresses, guideAlternates, guideLinkBySlug, guideLinks } = await import('./guides');
const { GuideIndexRoute, GuideRoute, guideIndexMetadata, guideMetadata } = await import('./guidePages');
const { frenchSpacing } = await import('../guides/markdown');

afterEach(() => { request.host = 'peek.example'; vi.unstubAllEnvs(); });

const ids = guideLinks('en').map(({ id }) => id);
const [first] = guideLinks('en');

describe('the guides as the server reads them', () => {
  it('has every guide in every language, in one order, each file under the address and title the app links', () => {
    expect(ids.length).toBeGreaterThan(0);
    for (const locale of SUPPORTED_LOCALES) {
      expect(guideLinks(locale).map(({ id }) => id)).toEqual(ids);
      for (const link of guideLinks(locale)) {
        const text = guide(locale, link.id);
        expect({ slug: text.slug, title: text.title }).toEqual({ slug: link.slug, title: link.title });
        expect(guideLinkBySlug(locale, link.slug)).toBe(link);
      }
    }
    expect(guideLinkBySlug('en', 'no-such-guide')).toBeUndefined();
  });

  it('knows where a guide lives in every language, and where the guides’ own page does', () => {
    expect(guideAddresses()).toEqual({ en: '/guides', de: '/de/guides', fr: '/fr/guides', it: '/it/guides', es: '/es/guides', pt: '/pt/guides', pl: '/pl/guides' });
    const addresses = guideAddresses(first.id);
    expect(addresses.en).toBe(`/guides/${first.slug}`);
    for (const locale of SUPPORTED_LOCALES) {
      expect(addresses[locale]).toBe(`${locale === 'en' ? '' : `/${locale}`}/guides/${guideLinks(locale).find(({ id }) => id === first.id)!.slug}`);
    }
    expect(guideAlternates(new URL('https://peek.example'), first.id)).toEqual({
      ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, `https://peek.example${addresses[locale]}`])),
      'x-default': `https://peek.example${addresses.en}`,
    });
  });
});

describe('what a guides page tells a search engine', () => {
  it('names the page itself as the one to index, and the same page in every language, on the canonical origin', async () => {
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
    const french = guideLinks('fr')[0];
    const text = guide('fr', french.id);
    const metadata = await guideMetadata('fr', french.slug);
    const address = (locale: Locale) => `https://peek.example.test${guideAddresses(french.id)[locale]}`;
    expect(metadata.title).toBe(`${french.title} — Peek`);
    expect(metadata.description).toBe(text.description);
    expect(metadata.metadataBase).toEqual(new URL('https://peek.example'));
    expect(metadata.alternates).toEqual({
      canonical: address('fr'),
      languages: { ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, address(locale)])), 'x-default': address('en') },
    });
    expect(metadata.openGraph).toMatchObject({
      type: 'article', url: address('fr'), siteName: 'Peek', locale: 'fr_FR', title: text.title,
      publishedTime: text.published, modifiedTime: text.updated,
      images: [{ url: expect.stringMatching(/^https:\/\/peek\.example\/og-fr\.png\?v=/), width: 1200, height: 630 }],
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: text.title });
  });

  it('keeps every title short enough for a search result', () => {
    for (const locale of SUPPORTED_LOCALES) for (const { title } of guideLinks(locale)) expect(title.length).toBeLessThanOrEqual(60);
  });

  it('does the same for the guides’ own page', async () => {
    const metadata = await guideIndexMetadata('de');
    expect(metadata.title).toBe(`${de['guides.heading']} — Peek`);
    expect(metadata.alternates).toMatchObject({ canonical: 'https://peek.example/de/guides', languages: { en: 'https://peek.example/guides', 'x-default': 'https://peek.example/guides' } });
    expect(metadata.openGraph).toMatchObject({ type: 'website', locale: 'de_DE' });
  });

  it('has no page for a guide that does not exist, and leaves its 404 to the page', async () => {
    // Metadata is resolved outside the page's not-found boundary: it must not throw.
    expect(await guideMetadata('en', 'no-such-guide')).toEqual({});
    await expect(GuideRoute({ locale: 'en', slug: 'no-such-guide' })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it('writes the guide with what it is, where it sits and where to read on', async () => {
    const html = renderToStaticMarkup(await GuideRoute({ locale: 'en', slug: first.slug }));
    const data = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]);
    const [article, crumbs] = data['@graph'];
    expect(article).toMatchObject({ '@type': 'Article', headline: first.title, inLanguage: 'en', mainEntityOfPage: `https://peek.example/guides/${first.slug}` });
    expect(crumbs.itemListElement.map((item: { item: string }) => item.item)).toEqual(['https://peek.example/', 'https://peek.example/guides', `https://peek.example/guides/${first.slug}`]);
    // Nothing in the data can close its element.
    expect(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]).not.toMatch(/[<>&]/);
    expect(html).toContain(`<h1>${first.title.replaceAll('&', '&amp;').replaceAll('\'', '&#x27;')}</h1>`);
    // It reads on with other guides, never with itself.
    const next = [...html.matchAll(/class="guide-card" href="([^"]+)"/g)].map(([, href]) => href);
    expect(next).toHaveLength(Math.min(3, ids.length - 1));
    expect(next).not.toContain(`/guides/${first.slug}`);
  });

  it('starts a guide’s trail at the landing in the guide’s language', async () => {
    const french = guideLinks('fr')[0];
    const html = renderToStaticMarkup(await GuideRoute({ locale: 'fr', slug: french.slug }));
    const [, crumbs] = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1])['@graph'];
    expect(crumbs.itemListElement.map((item: { item: string }) => item.item)).toEqual(['https://peek.example/fr', 'https://peek.example/fr/guides', `https://peek.example/fr/guides/${french.slug}`]);
  });

  it('writes the guides’ own page with a card for each', async () => {
    const html = renderToStaticMarkup(await GuideIndexRoute({ locale: 'it' }));
    expect([...html.matchAll(/class="guide-card" href="([^"]+)"/g)].map(([, href]) => href)).toEqual(guideLinks('it').map(({ slug }) => `/it/guides/${slug}`));
    expect(html).toContain('hrefLang="pl"');
  });

  it('sets a French page’s words as French is set, its code aside', async () => {
    for (const { slug } of guideLinks('fr')) {
      const html = renderToStaticMarkup(await GuideRoute({ locale: 'fr', slug }));
      const words = html.replace(/<script[\s\S]*?<\/script>|<code>[\s\S]*?<\/code>|<[^>]+>/g, '');
      expect(words, slug).not.toMatch(/ [?!;:»]|« /);
      expect(words).toContain(frenchSpacing(fr['guides.cta.title']));
    }
  });
});
