import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/errors/route';
import { browserErrorReporting, forwardBrowserErrors, sentryProject } from './browserErrors';
import { RateLimiter } from './rateLimit';

// A made-up project: nothing here reaches Sentry.
const dsn = 'https://0123456789abcdef@o1.ingest.example.test/42';
const production = { NODE_ENV: 'production', SENTRY_DSN: dsn } as NodeJS.ProcessEnv;
const commit = '0123456789abcdef0123456789abcdef01234567';
const none = { params: Promise.resolve({}) };
let address = 0;
const nextIp = () => `198.51.100.${++address % 250 + 1}`;

/** An envelope as the browser SDK writes it for a tunnel: its header names the DSN. */
function envelope(to = dsn, message = 'TypeError: x is not a function'): string {
  const event = { event_id: 'aa'.repeat(16), exception: { values: [{ type: 'TypeError', value: message }] } };
  const header = { event_id: event.event_id, sent_at: '2026-01-01T00:00:00.000Z', dsn: to, sdk: { name: 'sentry.javascript.browser', version: '11.5.0' } };
  return [header, { type: 'event' }, event].map((line) => JSON.stringify(line)).join('\n');
}

function report(body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest('https://delivery.example/api/errors', {
    method: 'POST',
    body,
    headers: { 'content-type': 'text/plain;charset=UTF-8', 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': nextIp(), ...headers },
  });
}

describe('what a page is told', () => {
  it('names the server\'s project, release and environment, in production only', () => {
    expect(browserErrorReporting({ ...production, IMAGE_COMMIT: commit, SENTRY_ENVIRONMENT: 'staging' }))
      .toEqual({ dsn, release: commit, environment: 'staging' });
    expect(browserErrorReporting(production)).toEqual({ dsn, environment: 'production' });
    expect(browserErrorReporting({ ...production, NODE_ENV: 'development' })).toBeNull();
    expect(browserErrorReporting({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
    expect(browserErrorReporting({ ...production, SENTRY_DSN: 'not a dsn' })).toBeNull();
  });

  it('never passes on the secret part of an old DSN', () => {
    expect(sentryProject('https://public:secret@sentry.example.test/prefix/7')).toEqual({
      dsn: 'https://public@sentry.example.test/prefix/7',
      envelope: 'https://sentry.example.test/prefix/api/7/envelope/',
    });
    for (const value of [undefined, '', 'https://sentry.example.test/7', 'https://key@sentry.example.test/project',
      'ftp://key@sentry.example.test/7', 'https://key@sentry.example.test/7?x=1']) {
      expect(sentryProject(value)).toBeNull();
    }
  });
});

describe('the error report tunnel', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value);
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes the browser\'s envelope on to the project, without the browser\'s address or cookies', async () => {
    const send = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', send);
    const body = envelope();
    const response = await POST(report(body, { cookie: 'session=secret', 'x-forwarded-for': '203.0.113.9' }), none);
    expect(response.status).toBe(204);
    expect(send).toHaveBeenCalledTimes(1);
    const [address, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(address).toBe('https://o1.ingest.example.test/api/42/envelope/');
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-sentry-envelope' });
    expect(Buffer.from(init.body as Uint8Array).toString('utf8')).toBe(body);
  });

  it('forwards nothing for another project, or for what is no envelope', async () => {
    const send = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', send);
    expect((await POST(report(envelope('https://0123456789abcdef@o1.ingest.example.test/43')), none)).status).toBe(400);
    expect((await POST(report(envelope('https://other@o1.ingest.example.test/42')), none)).status).toBe(400);
    expect((await POST(report(envelope('https://0123456789abcdef@elsewhere.example.test/42')), none)).status).toBe(400);
    expect((await POST(report('not an envelope'), none)).status).toBe(400);
    expect((await POST(report(''), none)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses reports from another site\'s pages, and large ones', async () => {
    const send = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', send);
    expect((await POST(report(envelope(), { 'sec-fetch-site': 'cross-site' }), none)).status).toBe(403);
    const large = envelope(dsn, 'x'.repeat(70_000));
    expect((await POST(report(large), none)).status).toBe(413);
    // A body that does not say its length is counted as it arrives.
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(large));
      controller.close();
    } });
    const streamed = new NextRequest('https://delivery.example/api/errors', {
      method: 'POST', body: stream, duplex: 'half', headers: { 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': nextIp() },
    } as ConstructorParameters<typeof NextRequest>[1]);
    expect((await POST(streamed, none)).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it('is off outside production and without a DSN', async () => {
    const send = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', send);
    vi.stubEnv('SENTRY_DSN', '');
    expect((await POST(report(envelope()), none)).status).toBe(404);
    vi.stubEnv('SENTRY_DSN', dsn);
    vi.stubEnv('NODE_ENV', 'development');
    expect((await POST(report(envelope()), none)).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it('limits each client, and every client together', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    const ip = nextIp();
    for (let sent = 0; sent < 10; sent += 1) {
      expect((await POST(report(envelope(), { 'cf-connecting-ip': ip }), none)).status).toBe(204);
    }
    const limited = await POST(report(envelope(), { 'cf-connecting-ip': ip }), none);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);

    const limiter = new RateLimiter(1);
    const send = vi.fn(async () => new Response(null, { status: 200 }));
    for (let sent = 0; sent < 60; sent += 1) {
      expect((await forwardBrowserErrors(report(envelope()), { env: production, send, limiter })).status).toBe(204);
    }
    await expect(forwardBrowserErrors(report(envelope()), { env: production, send, limiter }))
      .rejects.toMatchObject({ status: 429 });
    expect(send).toHaveBeenCalledTimes(60);
  });

  it('passes Sentry\'s limits back, so the browser waits', async () => {
    const send = vi.fn(async () => new Response(null, {
      status: 429, headers: { 'Retry-After': '60', 'X-Sentry-Rate-Limits': '60:error:organization' },
    }));
    const response = await forwardBrowserErrors(report(envelope()), { env: production, send, limiter: new RateLimiter(1) });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('X-Sentry-Rate-Limits')).toBe('60:error:organization');
  });

  it('answers 502 when Sentry fails or cannot be reached, and logs it without reporting it', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const options = { env: production, limiter: new RateLimiter(1) };
    expect((await forwardBrowserErrors(report(envelope()), { ...options, send: async () => new Response(null, { status: 503 }) })).status).toBe(502);
    expect((await forwardBrowserErrors(report(envelope()), { ...options, send: async () => new Response(null, { status: 413 }) })).status).toBe(400);
    expect((await forwardBrowserErrors(report(envelope()), { ...options, send: async () => { throw new TypeError('fetch failed'); } })).status).toBe(502);
    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)) as { event: string; upstream_status?: number; error_type?: string });
    expect(events).toEqual([
      expect.objectContaining({ event: 'browser_errors_refused', upstream_status: 503 }),
      expect.objectContaining({ event: 'browser_errors_refused', upstream_status: 413 }),
      expect.objectContaining({ event: 'browser_errors_forward_failed', error_type: 'TypeError' }),
    ]);
  });
});
