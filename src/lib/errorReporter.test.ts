import type { Event } from '@sentry/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IGNORED_ERRORS, reportable, scrubAddress, scrubEvent, scrubText, startErrorReports } from './errorReporter';

type Transport = ReturnType<NonNullable<Parameters<typeof startErrorReports>[1]>>;
type Envelope = Parameters<Transport['send']>[0];

// jsdom's page is http://localhost/; nothing here leaves the test.
const scripts = 'http://localhost/_next/static/chunks';
const config = { dsn: 'https://0123456789abcdef@o1.ingest.example.test/42', release: 'abc123', environment: 'production' };

/** An error thrown in the site's scripts, with a stack as Chrome writes it. */
function ownError(message: string, Type: ErrorConstructor = TypeError): Error {
  const error = new Type(message);
  error.stack = `${error.name}: ${message}\n    at render (${scripts}/app-1a2b.js:1:200)\n    at ${scripts}/main-3c4d.js:2:30`;
  return error;
}

function capture() {
  const envelopes: Envelope[] = [];
  const transport = () => ({
    send: async (envelope: Envelope) => {
      envelopes.push(envelope);
      return {};
    },
    flush: async () => true,
  });
  const events = () => envelopes.flatMap(([, items]) => items.map(([, payload]) => payload as Event));
  return { envelopes, events, send: startErrorReports(config, transport) };
}

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('what a report may say', () => {
  it('drops the query and the fragment, and the ids in a page\'s address', () => {
    expect(scrubAddress('https://peek.example/p/AbCdEfGhJkMn#name=Jo')).toBe('https://peek.example/p/:id');
    expect(scrubAddress('/i/AbCdEfGhJkMn?from=mail')).toBe('/i/:id');
    expect(scrubAddress('/parcels/LX123456785FR/edit')).toBe('/parcels/:id/edit');
    expect(scrubAddress('https://peek.example/unsubscribe?token=secret')).toBe('https://peek.example/unsubscribe');
    expect(scrubAddress('https://peek.example/fr/track/1Z999AA10123456784')).toBe('https://peek.example/fr/track/:id');
    expect(scrubAddress('https://peek.example/fr/settings')).toBe('https://peek.example/fr/settings');
  });

  it('keeps the names of the site\'s scripts, which their maps are found by', () => {
    expect(scrubAddress(`${scripts}/app/p/%5Bid%5D/page-0a1b2c3d4e5f.js?v=2`)).toBe(`${scripts}/app/p/%5Bid%5D/page-0a1b2c3d4e5f.js`);
  });

  it('filters numbers, keys and email addresses out of messages', () => {
    expect(scrubText('No parcel 1Z999AA10123456784 at https://peek.example/p/AbCdEfGhJkMn?x=1#Jo'))
      .toBe('No parcel [Filtered] at https://peek.example/p/:id');
    expect(scrubText('Bad key Q2xhdWRlLWtleS1mb3ItdGVzdHMtb25seS1hYmNkZWY')).toBe('Bad key [Filtered]');
    expect(scrubText('Bad key abcdefghijklmnopqrstuvwx1')).toBe('Bad key [Filtered]');
    expect(scrubText('Unknown owner jo@example.test')).toBe('Unknown owner [Filtered]');
    expect(scrubText('Cannot fetch "/api/links/AbCdEfGh2345?key=secret"')).toBe('Cannot fetch "/api/links/:id"');
    expect(scrubText('Cannot read properties of undefined (reading \'carrier\')'))
      .toBe('Cannot read properties of undefined (reading \'carrier\')');
  });

  it('keeps of a request its address and the browser, and drops who sent it', () => {
    const event = scrubEvent({
      message: 'Lost 1Z999AA10123456784',
      user: { ip_address: '203.0.113.9' },
      breadcrumbs: [{ message: 'clicked' }],
      extra: { key: 'secret' },
      transaction: '/p/AbCdEfGhJkMn',
      request: {
        url: 'http://localhost/p/AbCdEfGhJkMn#Jo',
        headers: { 'User-Agent': 'Firefox', Referer: 'https://mail.example/?token=secret', Cookie: 'a=b' },
      },
      exception: { values: [{ type: 'Error', value: 'Lost /p/AbCdEfGhJkMn', stacktrace: { frames: [
        { filename: `${scripts}/a.js?v=1`, abs_path: 'http://localhost/p/AbCdEfGhJkMn#Jo' },
      ] } }] },
    });
    expect(event).toEqual({
      message: 'Lost [Filtered]',
      request: { url: 'http://localhost/p/:id', headers: { 'User-Agent': 'Firefox' } },
      exception: { values: [{ type: 'Error', value: 'Lost /p/:id', stacktrace: { frames: [
        { filename: `${scripts}/a.js`, abs_path: 'http://localhost/p/:id' },
      ] } }] },
    });
    expect(scrubEvent({ request: { url: 'http://localhost/' } }).request).toEqual({ url: 'http://localhost/' });
  });

  it('counts an error as the page\'s when its stack runs through the site\'s scripts, and no extension', () => {
    const at = (...files: string[]): Event => ({ exception: { values: [{ stacktrace: { frames: files.map((filename) => ({ filename })) } }] } });
    expect(reportable(at(`${scripts}/a.js`), 'http://localhost')).toBe(true);
    expect(reportable(at(`${scripts}/a.js`, 'chrome-extension://abc/content.js'), 'http://localhost')).toBe(false);
    expect(reportable(at(`${scripts}/a.js`, 'safari-web-extension://abc/content.js'), 'http://localhost')).toBe(false);
    expect(reportable(at('https://cdn.example/_next/a.js'), 'http://localhost')).toBe(false);
    expect(reportable({ message: 'Script error.' }, 'http://localhost')).toBe(false);
  });

  it('knows the noise of networks, cancelled requests and resizes', () => {
    const ignored = (message: string) => IGNORED_ERRORS.some((pattern) => pattern.test(message));
    for (const message of ['TypeError: Failed to fetch', 'TypeError: Load failed', 'TypeError: cancelled', 'annulé',
      'AbortError: The user aborted a request.', 'TimeoutError: signal timed out', 'ChunkLoadError: Loading chunk 42 failed.',
      'TypeError: Failed to fetch dynamically imported module: x', 'ResizeObserver loop completed with undelivered notifications.',
      'NetworkError when attempting to fetch resource.']) {
      expect(ignored(message), message).toBe(true);
    }
    for (const message of ['TypeError: x is not a function', 'TypeError: Cannot read properties of undefined (reading \'id\')',
      'Error: Minified React error #418']) {
      expect(ignored(message), message).toBe(false);
    }
  });
});

describe('the reporter', () => {
  it('sends the page\'s errors through the site, without who saw them', async () => {
    history.replaceState(null, '', '/p/AbCdEfGhJkMn?from=mail#Jo%27s%20gift');
    const { envelopes, events, send } = capture();
    send({ error: ownError('Cannot read properties of undefined (reading \'events\')'), kind: 'onerror' });
    await vi.waitFor(() => expect(envelopes).toHaveLength(1));
    expect(envelopes[0]![0]).toMatchObject({ dsn: config.dsn });
    const [event] = events();
    expect(event).toMatchObject({
      level: 'error',
      release: 'abc123',
      environment: 'production',
      request: { url: 'http://localhost/p/:id' },
      sdk: { settings: { infer_ip: 'never' } },
    });
    expect(event!.user).toBeUndefined();
    expect(event!.breadcrumbs).toBeUndefined();
    const [exception] = event!.exception!.values!;
    expect(exception).toMatchObject({ type: 'TypeError', mechanism: { type: 'onerror', handled: false } });
    expect(exception!.stacktrace!.frames!.map((frame) => frame.filename)).toEqual([`${scripts}/main-3c4d.js`, `${scripts}/app-1a2b.js`]);
    expect(JSON.stringify(event)).not.toMatch(/AbCdEfGhJkMn|from=mail|gift/);
  });

  it('sends neither noise, nor an extension\'s or another site\'s errors, nor one twice', async () => {
    const { envelopes, events, send } = capture();
    send({ error: ownError('Failed to fetch'), kind: 'onunhandledrejection' });
    const injected = ownError('x is undefined');
    injected.stack += '\n    at chrome-extension://abc/content.js:1:1';
    send({ error: injected, kind: 'onerror' });
    const foreign = new TypeError('y is undefined');
    foreign.stack = 'TypeError: y is undefined\n    at https://ads.example/tag.js:1:1';
    send({ error: foreign, kind: 'onerror' });
    const twice = ownError('z is undefined');
    send({ error: twice, kind: 'onerror' });
    send({ error: twice, kind: 'onerror' });
    send({ error: ownError('the last one'), kind: 'error-boundary' });
    await vi.waitFor(() => expect(envelopes).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events().map((event) => event.exception!.values![0]!.value)).toEqual(['z is undefined', 'the last one']);
    expect(events()[1]!.exception!.values![0]!.mechanism).toMatchObject({ type: 'error-boundary', handled: true });
  });

  it('stops after a few reports from one page', async () => {
    const { envelopes, send } = capture();
    for (let error = 0; error < 8; error += 1) send({ error: ownError(`failure ${'abcdefgh'[error]}`), kind: 'onerror' });
    await vi.waitFor(() => expect(envelopes).toHaveLength(5));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(envelopes).toHaveLength(5);
  });

  it('places an error whose stack names no place where the browser said it was thrown', async () => {
    const { envelopes, events, send } = capture();
    send({ error: undefined, kind: 'onerror', message: 'SyntaxError: Unexpected token', filename: `${scripts}/broken.js`, lineno: 1, colno: 5 });
    await vi.waitFor(() => expect(envelopes).toHaveLength(1));
    expect(events()[0]!.exception!.values![0]!.stacktrace!.frames).toEqual([
      expect.objectContaining({ filename: `${scripts}/broken.js`, lineno: 1, colno: 5 }),
    ]);
  });
});
