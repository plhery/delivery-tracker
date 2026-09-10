import { readUpstreamHttpDiagnostics, type UpstreamHttpDiagnostics } from './upstreamHttpDiagnostics';

const DEFAULT_MAX_BYTES = 2_000_000;
const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_DIAGNOSTIC_BODY = 8_192;

interface UpstreamRequestDiagnostics {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  body_truncated?: boolean;
  timeout_ms: number;
}

function requestDiagnostics(url: string | URL, init: RequestInit, timeoutMs: number): UpstreamRequestDiagnostics {
  const body = typeof init.body === 'string' ? init.body
    : init.body instanceof URLSearchParams ? init.body.toString() : undefined;
  return { url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)),
    body: body?.slice(0, MAX_DIAGNOSTIC_BODY), body_truncated: body === undefined ? undefined : body.length > MAX_DIAGNOSTIC_BODY,
    timeout_ms: timeoutMs };
}

function retryDelay(header: string | null, status: number): number | null {
  // A rate limit without a retry window needs a later check, not another
  // request one second later. Explicit, short Retry-After windows remain safe.
  if (header === null) return status === 429 ? null : DEFAULT_RETRY_DELAY_MS;
  const value = header.trim();
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1_000
    : /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), /i.test(value)
      ? Date.parse(value) - Date.now()
      : NaN;
  if (!Number.isFinite(delay) || delay > MAX_RETRY_DELAY_MS) return null;
  return Math.max(DEFAULT_RETRY_DELAY_MS, delay);
}

async function waitBeforeRetry(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class UpstreamHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly retryAfterMs?: number,
    readonly diagnostics?: UpstreamHttpDiagnostics,
    readonly request?: UpstreamRequestDiagnostics,
  ) {
    super(`${provider} returned HTTP ${status}`);
    this.name = 'UpstreamHttpError';
  }
}

export class UpstreamNetworkError extends Error {
  constructor(readonly provider: string, cause: unknown, readonly request?: UpstreamRequestDiagnostics) {
    super(`${provider} is unreachable`, { cause });
    this.name = 'UpstreamNetworkError';
  }
}

async function cancelQuietly(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Cancellation is cleanup; it must not hide the response error.
  }
}

export async function fetchBounded(
  url: string | URL,
  init: RequestInit,
  options: {
    provider: string;
    timeoutMs?: number;
    maxBytes?: number;
    redirect?: RequestRedirect;
    fetcher?: typeof fetch;
    allowHttpError?: boolean;
    /** One retry for replayable reads only; never retry parsing or validation. */
    retryTransient?: boolean;
  },
): Promise<{ response: Response; bytes: Uint8Array }> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  let response: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await (options.fetcher ?? fetch)(url, {
        ...init,
        cache: 'no-store',
        redirect: options.redirect ?? 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch (error) {
      if (options.retryTransient && attempt === 0) {
        await waitBeforeRetry(DEFAULT_RETRY_DELAY_MS);
        continue;
      }
      throw new UpstreamNetworkError(options.provider, error, requestDiagnostics(url, init, options.timeoutMs ?? 15_000));
    }
    if (response.ok || options.allowHttpError) break;
    const delay = retryDelay(response.headers.get('retry-after'), response.status);
    if (options.retryTransient && attempt === 0
      && TRANSIENT_HTTP_STATUSES.has(response.status) && delay !== null) {
      await cancelQuietly(response.body);
      await waitBeforeRetry(delay);
      continue;
    }
    const retryHeader = response.headers.get('retry-after');
    const retryAfterMs = retryHeader === null ? undefined : /^\d+$/.test(retryHeader.trim())
      ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now();
    // Diagnostic failure must never replace the original HTTP status.
    const diagnostics = await readUpstreamHttpDiagnostics(response).catch(() => undefined);
    throw new UpstreamHttpError(options.provider, response.status,
      Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs!) : undefined, diagnostics,
      requestDiagnostics(url, init, options.timeoutMs ?? 15_000));
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelQuietly(response.body);
    throw new Error(`${options.provider} returned an unexpectedly large response`);
  }

  if (!response.body) return { response, bytes: new Uint8Array() };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read().catch((error: unknown) => {
        throw new UpstreamNetworkError(options.provider, error, requestDiagnostics(url, init, options.timeoutMs ?? 15_000));
      });
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the size error even if the upstream stream rejects cleanup.
        }
        throw new Error(`${options.provider} returned an unexpectedly large response`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { response, bytes };
}

export function decodeText(bytes: Uint8Array, encoding = 'utf-8'): string {
  return new TextDecoder(encoding, { fatal: false }).decode(bytes);
}

export function parseJsonBytes(bytes: Uint8Array, provider: string): unknown {
  try {
    return JSON.parse(decodeText(bytes).replace(/^\uFEFF/, ''));
  } catch (error) {
    throw Object.assign(new TypeError(`${provider} returned an invalid tracking response`, { cause: error }), {
      provider, response_body: decodeText(bytes.subarray(0, MAX_DIAGNOSTIC_BODY)),
      response_body_truncated: bytes.byteLength > MAX_DIAGNOSTIC_BODY,
    });
  }
}
