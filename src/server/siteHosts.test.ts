import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from '../../proxy';
import { GUIDE_LINKS } from '../generated/guides';
import { guidePath } from '../guides/paths';
import { ADDRESS_LANGUAGES, SUPPORTED_LOCALES } from '../lib/locale';
import { canonicalOrigin, legacyHostRedirect, movedOrigin, requestHost, siteHosts } from './siteHosts';

const moved = { CANONICAL_ORIGIN: 'https://peek.example.test', LEGACY_HOSTS: 'delivery.example.test, old.example.test' } as unknown as NodeJS.ProcessEnv;
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

function redirect(path: string, {
  host = 'delivery.example.test', method = 'GET', headers = {}, environment = moved,
}: { host?: string; method?: string; headers?: Record<string, string>; environment?: NodeJS.ProcessEnv } = {}) {
  const url = new URL(path, 'https://request.invalid');
  return legacyHostRedirect({ method, headers: new Headers({ host, ...headers }), pathname: url.pathname, search: url.search }, environment);
}

describe('siteHosts', () => {
  it('has one host and moves nothing when unset', () => {
    expect(siteHosts(env({}))).toBeNull();
    expect(siteHosts(env({ CANONICAL_ORIGIN: ' ', LEGACY_HOSTS: ' , ' }))).toBeNull();
    expect(redirect('/', { environment: env({}) })).toBeNull();
  });

  it('reads the canonical origin and the hosts that moved there', () => {
    expect(siteHosts(moved)).toEqual({
      canonicalOrigin: 'https://peek.example.test',
      legacyHosts: ['delivery.example.test', 'old.example.test'],
    });
    expect(siteHosts(env({ CANONICAL_ORIGIN: 'https://peek.example.test/', LEGACY_HOSTS: 'Delivery.Example.Test,delivery.example.test' })))
      .toEqual({ canonicalOrigin: 'https://peek.example.test', legacyHosts: ['delivery.example.test'] });
    expect(siteHosts(env({ CANONICAL_ORIGIN: 'https://peek.example.test' }))?.legacyHosts).toEqual([]);
  });

  it('names the canonical origin for the addresses the site writes, and none when unset or malformed', () => {
    expect(canonicalOrigin(moved)).toBe('https://peek.example.test');
    expect(canonicalOrigin(env({ CANONICAL_ORIGIN: 'https://peek.example.test/' }))).toBe('https://peek.example.test');
    expect(canonicalOrigin(env({}))).toBeNull();
    expect(canonicalOrigin(env({ CANONICAL_ORIGIN: 'peek.example.test' }))).toBeNull();
  });

  it.each([
    [{ LEGACY_HOSTS: 'delivery.example.test' }, /needs CANONICAL_ORIGIN/],
    [{ CANONICAL_ORIGIN: 'peek.example.test' }, /HTTP\(S\) origin/],
    [{ CANONICAL_ORIGIN: 'ftp://peek.example.test' }, /HTTP\(S\) origin/],
    [{ CANONICAL_ORIGIN: 'https://peek.example.test/app' }, /HTTP\(S\) origin/],
    [{ CANONICAL_ORIGIN: 'https://peek.example.test?x=1' }, /HTTP\(S\) origin/],
    [{ CANONICAL_ORIGIN: 'https://user:secret@peek.example.test' }, /HTTP\(S\) origin/],
    [{ CANONICAL_ORIGIN: 'https://peek.example.test', LEGACY_HOSTS: 'https://delivery.example.test' }, /hostnames/],
    [{ CANONICAL_ORIGIN: 'https://peek.example.test', LEGACY_HOSTS: 'delivery.example.test:8443' }, /hostnames/],
    [{ CANONICAL_ORIGIN: 'https://peek.example.test', LEGACY_HOSTS: 'delivery.example.test/path' }, /hostnames/],
    [{ CANONICAL_ORIGIN: 'https://peek.example.test', LEGACY_HOSTS: '*.example.test' }, /hostnames/],
    [{ CANONICAL_ORIGIN: 'https://peek.example.test', LEGACY_HOSTS: 'delivery.example.test,PEEK.example.test' }, /must not name the host/],
  ])('rejects a malformed setting without echoing it: %j', (values, message) => {
    expect(() => siteHosts(env(values))).toThrow(message);
    try { siteHosts(env(values)); } catch (error) { expect((error as Error).message).not.toMatch(/secret/); }
    // A request is never redirected by a setting the startup check refuses.
    expect(redirect('/', { environment: env(values) })).toBeNull();
  });
});

describe('requestHost', () => {
  it('prefers Host, then the forwarded host, and takes the first value of a list', () => {
    expect(requestHost(new Headers({ host: 'a.example.test', 'x-forwarded-host': 'b.example.test' }))).toBe('a.example.test');
    expect(requestHost(new Headers({ 'x-forwarded-host': 'b.example.test, c.example.test' }))).toBe('b.example.test');
    expect(requestHost(new Headers())).toBeNull();
    expect(requestHost(new Headers({ host: 'a'.repeat(254) }))).toBeNull();
  });

  it('does not let a forwarded host stand in for the one the proxy passed on', () => {
    expect(movedOrigin(new Headers({ host: 'peek.example.test', 'x-forwarded-host': 'delivery.example.test' }), moved)).toBeNull();
    expect(movedOrigin(new Headers({ 'x-forwarded-host': 'delivery.example.test' }), moved)).toBe('https://peek.example.test');
  });
});

describe('legacyHostRedirect', () => {
  it.each([
    ['/', 'https://peek.example.test/'],
    ['/?parcel=abc&view=friends', 'https://peek.example.test/?parcel=abc&view=friends'],
    ['/p/k7Qm2xW9bTfR', 'https://peek.example.test/p/k7Qm2xW9bTfR'],
    ['/p/k7Qm2xW9bTfR?utm_source=chat', 'https://peek.example.test/p/k7Qm2xW9bTfR?utm_source=chat'],
    ['/i/Ab7kP2mQ9xR4tY6n', 'https://peek.example.test/i/Ab7kP2mQ9xR4tY6n'],
    ['/invite?preview=' + 'a'.repeat(64), 'https://peek.example.test/invite?preview=' + 'a'.repeat(64)],
    ['/invite', 'https://peek.example.test/invite'],
    ['/demo', 'https://peek.example.test/demo'],
    ['/home', 'https://peek.example.test/home'],
    ['/de', 'https://peek.example.test/de'],
    ['/pl?utm_source=chat', 'https://peek.example.test/pl?utm_source=chat'],
    ['/privacy.html', 'https://peek.example.test/privacy.html'],
    ['/apiary', 'https://peek.example.test/apiary'],
  ])('sends the page %s to the same address on the canonical origin', (path, target) => {
    expect(redirect(path)).toBe(target);
    expect(redirect(path, { method: 'HEAD' })).toBe(target);
    expect(redirect(path, { headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } })).toBe(target);
    expect(redirect(path, { host: 'old.example.test' })).toBe(target);
  });

  it.each([
    '/api/packages', '/api/public/parcels/k7Qm2xW9bTfR', '/api/friends/invite-image?preview=abc', '/api',
    '/health', '/health/live',
    '/_next/static/chunks/main-app-0123.js', '/_next/image?url=%2Fog.png', '/icons/icon-192.png', '/fonts/gelasio/regular.woff2',
    '/favicon.ico', '/robots.txt', '/sitemap.xml', '/privacy.css', '/theme.css',
    '/sw.js', '/push-sw.js', '/manifest.webmanifest',
    '/.well-known/apple-app-site-association', '/.well-known/assetlinks.json',
    '/auth-emails/magic-link.html', '/og.png', '/og.png?v=73229339', '/og.svg',
    '/share-target', '/share-target/draft',
  ])('leaves %s on the host it was asked from', (path) => {
    expect(redirect(path)).toBeNull();
    expect(redirect(path, { headers: { 'sec-fetch-mode': 'navigate' } })).toBeNull();
  });

  it('moves only someone opening a page: the service worker still fetches its app shell from the legacy host', () => {
    for (const mode of ['cors', 'same-origin', 'no-cors', 'websocket']) {
      expect(redirect('/', { headers: { 'sec-fetch-mode': mode } })).toBeNull();
      expect(redirect('/~offline', { headers: { 'sec-fetch-mode': mode } })).toBeNull();
    }
    expect(redirect('/~offline')).toBe('https://peek.example.test/~offline');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('never redirects %s', (method) => {
    expect(redirect('/', { method })).toBeNull();
    expect(redirect('/share-target', { method })).toBeNull();
  });

  it('answers the canonical host and hosts it does not know as before', () => {
    for (const host of ['peek.example.test', 'peek.example.test:443', 'localhost:3000', '127.0.0.1:3000', '[::1]:3000',
      'delivery.example.test.evil.example', 'evil.example', 'xdelivery.example.test', 'internal']) {
      expect(redirect('/', { host })).toBeNull();
      expect(redirect('/p/k7Qm2xW9bTfR', { host })).toBeNull();
    }
  });

  it('recognises a legacy host whatever its case, port or trailing dot', () => {
    for (const host of ['DELIVERY.example.test', 'delivery.example.test:443', 'delivery.example.test.', 'delivery.example.test, peek.example.test']) {
      expect(redirect('/i/Ab7kP2mQ9xR4tY6n', { host })).toBe('https://peek.example.test/i/Ab7kP2mQ9xR4tY6n');
    }
  });

  it('takes the target origin from the setting alone, whatever the request says', () => {
    const hostile = { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http', origin: 'https://evil.example', referer: 'https://evil.example/' };
    expect(redirect('/?next=https://evil.example', { headers: hostile })).toBe('https://peek.example.test/?next=https://evil.example');
    for (const pathname of ['//evil.example/x', '/\\evil.example', '/%2F%2Fevil.example', '/@evil.example', '/https://evil.example']) {
      const target = legacyHostRedirect({ method: 'GET', headers: new Headers({ host: 'delivery.example.test' }), pathname, search: '' }, moved);
      expect(new URL(target!).origin).toBe('https://peek.example.test');
    }
    expect(legacyHostRedirect({ method: 'GET', headers: new Headers({ host: 'delivery.example.test' }), pathname: 'evil.example', search: '' }, moved)).toBeNull();
  });
});

describe('the page proxy', () => {
  const page = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => proxy(new NextRequest(url, init));
  afterEach(() => { vi.unstubAllEnvs(); });

  it('answers a page on a legacy host with a permanent redirect that nothing stores', () => {
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
    vi.stubEnv('LEGACY_HOSTS', 'delivery.example.test');
    const response = page('https://delivery.example.test/i/Ab7kP2mQ9xR4tY6n?utm_source=chat', { headers: { host: 'delivery.example.test' } });
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://peek.example.test/i/Ab7kP2mQ9xR4tY6n?utm_source=chat');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('renders the page everywhere else, and for the legacy host’s own service worker', () => {
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
    vi.stubEnv('LEGACY_HOSTS', 'delivery.example.test');
    for (const response of [
      page('https://peek.example.test/', { headers: { host: 'peek.example.test' } }),
      page('https://delivery.example.test/', { headers: { host: 'delivery.example.test', 'sec-fetch-mode': 'cors' } }),
      page('https://delivery.example.test/share-target', { method: 'POST', headers: { host: 'delivery.example.test' } }),
    ]) {
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    }
  });

  it('renders a language address as if its language had been chosen, without writing the browser’s cookie', () => {
    // What the page will read, as the proxy hands it on.
    const cookieRead = (response: Response) => response.headers.get('x-middleware-request-cookie');
    for (const language of ADDRESS_LANGUAGES) {
      const response = page(`https://peek.example.test/${language}`, { headers: { host: 'peek.example.test', cookie: 'sdt.locale=en; other=1', 'accept-language': 'en-GB' } });
      expect(response.status).toBe(200);
      expect(cookieRead(response)).toBe(`sdt.locale=${language}; other=1`);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    }
    expect(cookieRead(page('https://peek.example.test/de', { headers: { host: 'peek.example.test' } }))).toBe('sdt.locale=de');
    // Every other address reads the browser's own choice, untouched.
    for (const path of ['/', '/home', '/en', '/xx', '/de/more', '/demo', '/p/k7Qm2xW9bTfR', '/en/guides', '/xx/guides', '/guidesmore']) {
      expect(cookieRead(page(`https://peek.example.test${path}`, { headers: { host: 'peek.example.test', cookie: 'sdt.locale=fr' } })), path).toBe('sdt.locale=fr');
      expect(cookieRead(page(`https://peek.example.test${path}`, { headers: { host: 'peek.example.test' } })), path).toBeNull();
    }
  });

  it('renders the guides in their address’s language, whatever the browser sent', () => {
    const cookieRead = (response: Response) => response.headers.get('x-middleware-request-cookie');
    for (const locale of SUPPORTED_LOCALES) {
      const other = locale === 'de' ? 'fr' : 'de';
      for (const path of [guidePath(locale), guidePath(locale, GUIDE_LINKS[locale][0].slug)]) {
        const response = page(`https://peek.example.test${path}`, { headers: { host: 'peek.example.test', cookie: `sdt.locale=${other}; other=1`, 'accept-language': other } });
        expect(response.status, path).toBe(200);
        expect(cookieRead(response), path).toBe(`sdt.locale=${locale}; other=1`);
        expect(response.headers.get('set-cookie'), path).toBeNull();
        expect(cookieRead(page(`https://peek.example.test${path}`, { headers: { host: 'peek.example.test' } })), path).toBe(`sdt.locale=${locale}`);
      }
    }
  });

  it('answers an address below a language’s guides that names none of them with the 404 page, in that language', () => {
    const rewrite = (path: string) => page(`https://peek.example.test${path}`, { headers: { host: 'peek.example.test', cookie: 'sdt.locale=de' } });
    for (const locale of SUPPORTED_LOCALES) {
      const [{ slug }] = GUIDE_LINKS[locale];
      for (const path of [guidePath(locale, 'no-such-guide'), guidePath(locale, slug.toUpperCase()), guidePath(locale, `${slug}/more`)]) {
        const response = rewrite(path);
        expect(response.headers.get('x-middleware-rewrite'), path).toBe('https://peek.example.test/_not-found');
        expect(response.headers.get('x-middleware-request-cookie'), path).toBe(`sdt.locale=${locale}`);
        expect(response.headers.get('content-security-policy'), path).toContain("default-src 'self'");
        expect(response.headers.get('cache-control'), path).toBe('private, no-store');
      }
      for (const path of [guidePath(locale), guidePath(locale, slug)]) expect(rewrite(path).headers.get('x-middleware-rewrite'), path).toBeNull();
    }
    for (const path of ['/', '/de', '/xx', '/en/guides/x', '/guidesmore']) expect(rewrite(path).headers.get('x-middleware-rewrite'), path).toBeNull();
  });

  it('always answers a language address and the guides itself, a prefetch too', () => {
    const [pages, languages] = config.matcher;
    expect(pages.missing).toHaveLength(2);
    expect(languages).toEqual({ source: `/:language(${ADDRESS_LANGUAGES.join('|')})` });
    const matches = (url: string, headers = {}) => unstable_doesMiddlewareMatch({ config, url, headers });
    const prefetch = { 'next-router-prefetch': '1', rsc: '1' };
    for (const locale of ADDRESS_LANGUAGES) expect(matches(`/${locale}`, prefetch), locale).toBe(true);
    for (const locale of SUPPORTED_LOCALES) {
      for (const path of [guidePath(locale), guidePath(locale, GUIDE_LINKS[locale][0].slug), guidePath(locale, 'no-such-guide')]) {
        expect(matches(path), path).toBe(true);
        expect(matches(path, prefetch), path).toBe(true);
        expect(matches(path, { purpose: 'prefetch' }), path).toBe(true);
      }
    }
    // Other pages are not answered for a prefetch, which renders nothing the proxy needs to set.
    expect(matches('/demo', prefetch)).toBe(false);
    expect(matches('/demo')).toBe(true);
  });

  it('sends a language address on a legacy host to the same address on the canonical one', () => {
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
    vi.stubEnv('LEGACY_HOSTS', 'delivery.example.test');
    const response = page('https://delivery.example.test/de', { headers: { host: 'delivery.example.test' } });
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://peek.example.test/de');
  });

  it('redirects nothing without the settings', () => {
    vi.stubEnv('CANONICAL_ORIGIN', '');
    vi.stubEnv('LEGACY_HOSTS', '');
    const response = page('https://delivery.example.test/', { headers: { host: 'delivery.example.test' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
