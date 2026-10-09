// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../../shared/locales/de.json';
import en from '../../../shared/locales/en.json';
import { GET } from '../../../app/email/example/route';
import { config } from '../../../proxy';

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => request.headers), cookies: vi.fn(async () => ({ get: () => undefined })) }));

// Drawing takes a moment, and longer on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const example = (query = '') => GET(new Request(`https://peek.example.test/email/example${query}`));

beforeEach(() => {
  request.headers = new Headers({ host: 'peek.example.test', 'x-forwarded-proto': 'https' });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('GET /email/example', () => {
  it('answers the email as a page of its own, in the language asked for', async () => {
    const response = await example('?lang=de');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await response.text();
    expect(html.startsWith('<!doctype html>\n<html lang="de">')).toBe(true);
    expect(html).toContain(`>${de['email.delivered.title'].replace('{{name}}', 'Neue Sneaker 👟')}</h1>`);
    expect(html).toContain(de['email.delivered.by.today'].replace('{{carrier}}', 'DHL').replace('{{time}}', '14:12'));
    expect(html).toContain(`alt="${de['map.label'].replace('{{from}}', 'Hamburg').replace('{{to}}', 'Zürich')}"`);
    expect(html).not.toContain('{{');
  });

  it('carries its picture inside the document, and nothing else to load', async () => {
    const html = await (await example('?lang=en')).text();
    const [, card] = /<img src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(html)!;
    const png = Buffer.from(card, 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1040);
    expect(png.length).toBeLessThan(200_000);
    expect(html).not.toContain('cid:');
    expect(html.match(/\bsrc=/g)).toHaveLength(1);
    expect(html).not.toMatch(/<(?:script|style|link|iframe|form)\b/i);
  });

  it('may be kept for an hour, is not for search engines, and allows itself inline styles and its own picture only', async () => {
    const response = await example();
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('content-security-policy'))
      .toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    // English when no language, or an unknown one, is asked for.
    expect(await response.text()).toContain(`>${en['email.delivered.title'].replace('{{name}}', 'New trainers 👟')}</h1>`);
    expect(await (await example('?lang=xx')).text()).toContain('<html lang="en">');
  });

  it('links the site it is read on, or the site the deployment names', async () => {
    const links = async () => [...(await (await example()).text()).matchAll(/href="([^"]*)"/g)].map(([, href]) => href);
    // Home, the off page without a token, the privacy notice and the code.
    expect(new Set(await links())).toEqual(new Set([
      'https://peek.example.test/', 'https://peek.example.test/email/off', 'https://peek.example.test/privacy.html', 'https://github.com/plhery/peek-delivery-tracker',
    ]));
    request.headers = new Headers({ host: '127.0.0.1:4173' });
    expect(await links()).toContain('http://127.0.0.1:4173/email/off');
    vi.stubEnv('CANONICAL_ORIGIN', 'https://canonical.example.test');
    expect(new Set(await links())).toEqual(new Set([
      'https://canonical.example.test/', 'https://canonical.example.test/email/off', 'https://canonical.example.test/privacy.html', 'https://github.com/plhery/peek-delivery-tracker',
    ]));
    // A setting the deployment got wrong is reported at startup; the example still reads.
    vi.stubEnv('CANONICAL_ORIGIN', 'not an origin');
    expect(await links()).toContain('http://127.0.0.1:4173/');
  });

  it('is left alone by the page proxy, which would mark it private and give it the app’s policy', () => {
    const pages = new RegExp(`^${config.matcher[0].source}$`);
    expect(pages.test('/email/example')).toBe(false);
    // The page that turns the email off is a page of the app.
    expect(pages.test('/email/off')).toBe(true);
    expect(pages.test('/email')).toBe(true);
  });
});
