import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from '../../proxy';
import { legacyHostRedirect, movedOrigin, requestHost, siteHosts } from './siteHosts';

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
    '/favicon.ico', '/privacy.css', '/theme.css',
    '/sw.js', '/push-sw.js', '/manifest.webmanifest',
    '/.well-known/apple-app-site-association', '/.well-known/assetlinks.json',
    '/auth-emails/magic-link.html', '/og.png', '/og.png?v=dfc8f714', '/og.svg',
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

  it('redirects nothing without the settings', () => {
    vi.stubEnv('CANONICAL_ORIGIN', '');
    vi.stubEnv('LEGACY_HOSTS', '');
    const response = page('https://delivery.example.test/', { headers: { host: 'delivery.example.test' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
