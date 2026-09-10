const MAX_BYTES = 8_192;
const READ_TIMEOUT_MS = 200;
const CONTENT_TYPES = new Set(['text/html', 'text/plain', 'application/json', 'application/problem+json', 'application/xml', 'text/xml']);
const ERROR_CODES = new Set(['ACCESS_DENIED', 'FORBIDDEN', 'UNAUTHORIZED', 'RATE_LIMITED', 'TOO_MANY_REQUESTS',
  'CAPTCHA_REQUIRED', 'CHALLENGE_REQUIRED', 'INVALID_TOKEN', 'TOKEN_EXPIRED']);

export interface UpstreamHttpDiagnostics {
  content_type: string;
  server?: string;
  request_ids: Record<string, string>;
  body_read: 'complete' | 'truncated' | 'timed_out' | 'unreadable' | 'empty' | 'skipped';
  bytes_inspected: number;
  /** Recognized signatures, not a definitive explanation of the rejection. */
  body_signals: string[];
  body_excerpt?: string;
  error_code?: string;
}

function responseIds(headers: Headers): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const name of ['cf-ray', 'x-request-id', 'x-correlation-id', 'x-akamai-request-id']) {
    const value = headers.get(name)?.trim();
    if (value) ids[name] = value.slice(0, 128);
  }
  return ids;
}

function recognizedCode(text: string): string | undefined {
  try {
    const value: unknown = JSON.parse(text);
    const record = (item: unknown): Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const root = record(value);
    const error = record(root.error);
    for (const code of [root.code, root.errorCode, root.error, error.code]) {
      if (typeof code === 'string' && ERROR_CODES.has(code.toUpperCase())) return code.toUpperCase();
    }
  } catch { /* HTML, truncated JSON and unknown formats have no recognized code. */ }
  return undefined;
}

/** Bounded error excerpts are authorized diagnostics; never copy cookie/auth headers. */
export async function readUpstreamHttpDiagnostics(response: Response): Promise<UpstreamHttpDiagnostics> {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const diagnostics: UpstreamHttpDiagnostics = {
    content_type: !mediaType ? 'missing' : CONTENT_TYPES.has(mediaType) ? mediaType : 'other',
    request_ids: responseIds(response.headers), body_read: 'empty', bytes_inspected: 0, body_signals: [],
    server: response.headers.get('server')?.slice(0, 128),
  };
  if (!response.body) return diagnostics;
  if (diagnostics.content_type === 'other') {
    diagnostics.body_read = 'skipped';
    void response.body.cancel().catch(() => {});
    return diagnostics;
  }
  const reader = response.body.getReader();
  const prefix = new Uint8Array(MAX_BYTES);
  const expiresAt = performance.now() + READ_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS); });
  try {
    while (diagnostics.bytes_inspected < MAX_BYTES) {
      if (performance.now() >= expiresAt) { diagnostics.body_read = 'timed_out'; break; }
      const part = await Promise.race([reader.read(), deadline]);
      if (part === null) { diagnostics.body_read = 'timed_out'; break; }
      if (part.done) { diagnostics.body_read = diagnostics.bytes_inspected ? 'complete' : 'empty'; break; }
      const bytes = part.value.subarray(0, MAX_BYTES - diagnostics.bytes_inspected);
      prefix.set(bytes, diagnostics.bytes_inspected);
      diagnostics.bytes_inspected += bytes.byteLength;
      if (diagnostics.bytes_inspected === MAX_BYTES) diagnostics.body_read = 'truncated';
    }
  } catch {
    diagnostics.body_read = 'unreadable';
  } finally {
    clearTimeout(timer);
    // A stuck upstream cancellation must not delay the original HTTP error.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const text = new TextDecoder().decode(prefix.subarray(0, diagnostics.bytes_inspected));
  if (text) diagnostics.body_excerpt = text;
  const signatures: [string, RegExp][] = [
    ['cloudflare_challenge', /(?:\/cdn-cgi\/challenge-platform\/|\b_cf_chl_opt\b)/i],
    ['datadome_challenge', /(?:geo\.captcha-delivery\.com|ct\.captcha-delivery\.com)/i],
    ['perimeterx_challenge', /(?:\bpx-captcha\b|captcha\.px-cdn\.net)/i],
    ['akamai_error_page', /errors\.edgesuite\.net\//i],
    ['access_denied', /\baccess denied\b|\baccès refusé\b/i],
    ['rate_limit_message', /\btoo many requests\b|\brate limit exceeded\b/i],
    ['captcha_message', /\bcaptcha\b/i],
  ];
  diagnostics.body_signals = signatures.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  if (diagnostics.body_read === 'complete') diagnostics.error_code = recognizedCode(text);
  return diagnostics;
}
