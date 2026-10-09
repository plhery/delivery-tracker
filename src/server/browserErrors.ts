import 'server-only';

import type { ErrorReportsConfig } from '../lib/errorReportsConfig';
import { HttpError, noContent } from './api';
import { errorType, logOperationalEvent, resolveSentryRelease } from './observability';
import { RateLimiter } from './rateLimit';

/** What one report may weigh. An error with its stack and causes is a few kilobytes. */
const MAX_ENVELOPE_BYTES = 65_536;
/** Every browser together: a release that breaks every page still sends Sentry a bounded stream. */
const OVERALL_LIMIT = { limit: 60, window: 600 };
const overall = new RateLimiter(1);

interface SentryProject {
  /** The DSN without the secret part an old one may carry: what a browser may be told. */
  dsn: string;
  /** Where the project takes envelopes. */
  envelope: string;
}

/** The project a DSN names, or null for anything that is not one. */
export function sentryProject(value: unknown): SentryProject | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    const match = /^(.*)\/(\d+)$/.exec(url.pathname);
    if (!['https:', 'http:'].includes(url.protocol) || !url.username || !match || url.search || url.hash) return null;
    const base = `${url.protocol}//${url.host}${match[1]}`;
    return {
      dsn: `${url.protocol}//${url.username}@${url.host}${match[1]}/${match[2]}`,
      envelope: `${base}/api/${match[2]}/envelope/`,
    };
  } catch {
    return null;
  }
}

function project(env: NodeJS.ProcessEnv): SentryProject | null {
  return env.NODE_ENV === 'production' ? sentryProject(env.SENTRY_DSN) : null;
}

/**
 * What a page tells its scripts so they can report their errors: the server's
 * project, release and environment. Null outside production and without a
 * DSN, where browsers report nothing.
 */
export function browserErrorReporting(env: NodeJS.ProcessEnv = process.env): ErrorReportsConfig | null {
  const target = project(env);
  if (!target) return null;
  const release = resolveSentryRelease(env);
  return { dsn: target.dsn, ...(release ? { release } : {}), environment: env.SENTRY_ENVIRONMENT?.trim() || 'production' };
}

async function readEnvelope(request: Request): Promise<Buffer> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_ENVELOPE_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    throw new HttpError(413, 'The error report is too large');
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ENVELOPE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, 'The error report is too large');
    }
    chunks.push(value);
  }
  if (!size) throw new HttpError(400, 'Send an error report');
  return Buffer.concat(chunks);
}

/** The DSN an envelope names in its first line, its header. */
function envelopeDsn(envelope: Buffer): unknown {
  const end = envelope.indexOf(10);
  try {
    const header: unknown = JSON.parse(envelope.subarray(0, end === -1 ? envelope.length : end).toString('utf8'));
    return header && typeof header === 'object' ? (header as { dsn?: unknown }).dsn : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Passes a browser's error report on to the server's own Sentry project, and
 * nowhere else. The browser's address, cookies and headers stay here. Sentry's
 * answer to an envelope it limits goes back, so the browser's SDK waits.
 */
export async function forwardBrowserErrors(
  request: Request,
  { env = process.env, send = fetch, limiter = overall }: {
    env?: NodeJS.ProcessEnv; send?: typeof fetch; limiter?: RateLimiter;
  } = {},
): Promise<Response> {
  const target = project(env);
  if (!target) throw new HttpError(404, 'Error reports are off');
  const envelope = await readEnvelope(request);
  if (sentryProject(envelopeDsn(envelope))?.dsn !== target.dsn) {
    throw new HttpError(400, 'Not an error report for this site');
  }
  const retryAfter = limiter.retryAfter('all', OVERALL_LIMIT);
  if (retryAfter) {
    throw new HttpError(429, 'Too many error reports. Try again later.', { 'Retry-After': String(retryAfter) });
  }
  let response: Response;
  try {
    response = await send(target.envelope, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: new Uint8Array(envelope),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    logOperationalEvent('browser_errors_forward_failed', { error_type: errorType(error) }, 'warning');
    return noContent(502);
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.ok) return noContent();
  logOperationalEvent('browser_errors_refused', { upstream_status: response.status }, 'warning');
  const limits = Object.fromEntries(['Retry-After', 'X-Sentry-Rate-Limits']
    .flatMap((name) => response.headers.get(name) ? [[name, response.headers.get(name)!]] : []));
  return noContent(response.status === 429 ? 429 : response.status < 500 ? 400 : 502, limits);
}
