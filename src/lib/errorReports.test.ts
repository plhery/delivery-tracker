import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingReport } from './errorReports';

const mocks = vi.hoisted(() => ({
  sent: [] as PendingReport[],
  startErrorReports: vi.fn(),
}));
vi.mock('./errorReporter', () => ({ startErrorReports: mocks.startErrorReports }));

const scripts = 'http://localhost/_next/static/chunks';
const config = { dsn: 'https://0123456789abcdef@o1.ingest.example.test/42', release: 'abc123', environment: 'production' };

function ownError(message: string): Error {
  const error = new TypeError(message);
  error.stack = `TypeError: ${message}\n    at render (${scripts}/app.js:1:200)`;
  return error;
}

function nameProject(content: unknown = config) {
  const meta = document.createElement('meta');
  meta.name = 'error-reports';
  meta.content = typeof content === 'string' ? content : JSON.stringify(content);
  document.head.append(meta);
}

/** A fresh watcher, on a target of its own. */
async function watch() {
  vi.resetModules();
  const reports = await import('./errorReports');
  const target = new EventTarget() as Window;
  reports.watchBrowserErrors(target);
  return { ...reports, target };
}

function rejection(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason });
}

beforeEach(() => {
  mocks.sent = [];
  mocks.startErrorReports.mockReset().mockImplementation(() => (report: PendingReport) => mocks.sent.push(report));
});
afterEach(() => {
  document.head.querySelectorAll('meta[name="error-reports"]').forEach((meta) => meta.remove());
});

describe('the page\'s error watcher', () => {
  it('holds the errors thrown before the reporter loads, and hands them over', async () => {
    nameProject();
    const { target } = await watch();
    const first = ownError('first');
    target.dispatchEvent(new ErrorEvent('error', { error: first, message: 'Uncaught TypeError: first', filename: `${scripts}/app.js`, lineno: 1, colno: 200 }));
    target.dispatchEvent(rejection(ownError('second')));
    await vi.waitFor(() => expect(mocks.sent).toHaveLength(2));
    expect(mocks.startErrorReports).toHaveBeenCalledTimes(1);
    expect(mocks.startErrorReports).toHaveBeenCalledWith(config);
    expect(mocks.sent[0]).toEqual({ error: first, kind: 'onerror', message: 'Uncaught TypeError: first', filename: `${scripts}/app.js`, lineno: 1, colno: 200 });
    expect(mocks.sent[1]).toMatchObject({ kind: 'onunhandledrejection' });
    target.dispatchEvent(rejection(ownError('third')));
    expect(mocks.sent).toHaveLength(3);
    expect(mocks.startErrorReports).toHaveBeenCalledTimes(1);
  });

  it('holds only the first few', async () => {
    nameProject({ dsn: config.dsn, environment: 'production' });
    const { target } = await watch();
    for (let error = 0; error < 15; error += 1) target.dispatchEvent(rejection(ownError(`error ${error}`)));
    await vi.waitFor(() => expect(mocks.sent).toHaveLength(10));
    expect(mocks.startErrorReports).toHaveBeenCalledWith({ dsn: config.dsn, environment: 'production' });
  });

  it('leaves alone what other scripts throw, and rejections that are no error', async () => {
    nameProject();
    const { target } = await watch();
    target.dispatchEvent(new ErrorEvent('error', { error: new Error('x'), filename: 'chrome-extension://abc/content.js' }));
    target.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '' }));
    target.dispatchEvent(new ErrorEvent('error', { error: ownError('x'), filename: 'https://ads.example/_next/tag.js' }));
    target.dispatchEvent(rejection('a string'));
    target.dispatchEvent(rejection(new Error('elsewhere')));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.startErrorReports).not.toHaveBeenCalled();
  });

  it('reports what the error screen caught, but not the server\'s errors, which the server reported', async () => {
    nameProject();
    const { reportCaughtError } = await watch();
    reportCaughtError(Object.assign(new Error('An error occurred in the Server Components render.'), { digest: '12345' }));
    const caught = ownError('caught');
    reportCaughtError(caught);
    await vi.waitFor(() => expect(mocks.sent).toEqual([{ error: caught, kind: 'error-boundary' }]));
  });

  it('loads nothing where the page names no project', async () => {
    const { target } = await watch();
    target.dispatchEvent(rejection(ownError('first')));
    nameProject();
    target.dispatchEvent(rejection(ownError('second')));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.startErrorReports).not.toHaveBeenCalled();

    for (const content of ['not json', '"a string"', JSON.stringify({ dsn: 42, environment: 'production' })]) {
      document.head.querySelectorAll('meta[name="error-reports"]').forEach((meta) => meta.remove());
      nameProject(content);
      const { target: next } = await watch();
      next.dispatchEvent(rejection(ownError('error')));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.startErrorReports).not.toHaveBeenCalled();
  });

  it('goes quiet when the reporter fails to start', async () => {
    nameProject();
    mocks.startErrorReports.mockImplementation(() => {
      throw new Error('blocked');
    });
    const { target } = await watch();
    target.dispatchEvent(rejection(ownError('first')));
    await vi.waitFor(() => expect(mocks.startErrorReports).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    target.dispatchEvent(rejection(ownError('second')));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.startErrorReports).toHaveBeenCalledTimes(1);
    expect(mocks.sent).toEqual([]);
  });
});
