import { apiAnalyticsEvent, trackAction } from './analytics';

export class ApiAuthenticationError extends Error {
  constructor() {
    super('Your sign-in expired. Please sign in again.');
    this.name = 'ApiAuthenticationError';
  }
}

export interface ApiAuth {
  userId: string;
  getAccessToken: (refresh?: boolean) => Promise<string | null>;
  /** Aborted synchronously when this sign-in ends, including signing back into the same account. */
  signal?: AbortSignal;
  onAuthenticationFailure?: () => Promise<void>;
}

/** Bound operations that do not themselves support cancellation, such as token refresh. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** One deadline covers token lookup, the request and its single authentication retry. */
async function performAuthenticatedFetch(
  path: string,
  auth: ApiAuth | undefined,
  init?: RequestInit,
): Promise<Response> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(init?.signal ? [init.signal] : []),
    ...(auth?.signal ? [auth.signal] : []),
  ]);
  async function token(refresh = false) {
    signal.throwIfAborted();
    const value = await abortable(auth?.getAccessToken(refresh) ?? Promise.resolve(null), signal);
    signal.throwIfAborted();
    return value;
  }
  async function perform(accessToken: string | null) {
    signal.throwIfAborted();
    const headers = new Headers(init?.headers);
    headers.set('X-Requested-With', 'XMLHttpRequest');
    if (init?.body) headers.set('Content-Type', 'application/json');
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    const response = await abortable(fetch(path, {
      ...init, cache: 'no-store', redirect: 'manual', headers, signal,
    }), signal);
    signal.throwIfAborted();
    return response;
  }

  let response = await perform(await token());
  if (auth && (response.status === 401 || response.status === 403)) {
    // A transient refresh failure must not discard a recoverable session.
    const accessToken = await token(true);
    if (accessToken) response = await perform(accessToken);
  }
  signal.throwIfAborted();
  if (response.type === 'opaqueredirect' || response.redirected
    || response.status === 401 || response.status === 403) {
    // Local sign-out starts synchronously; notification cleanup cannot hold up this request.
    void auth?.onAuthenticationFailure?.().catch(() => undefined);
    throw new ApiAuthenticationError();
  }
  return response;
}

/** Record one result after any auth retry; background reads are excluded. */
export async function authenticatedFetch(path: string, auth: ApiAuth | undefined, init?: RequestInit): Promise<Response> {
  const event = apiAnalyticsEvent(path, init?.method ?? 'GET', init?.body);
  try {
    const response = await performAuthenticatedFetch(path, auth, init);
    if (event) trackAction(event, response.ok ? (response.status === 202 ? 'accepted' : 'success') : 'error');
    return response;
  } catch (error) {
    if (event && !(error instanceof DOMException && error.name === 'AbortError')) trackAction(event, 'error');
    throw error;
  }
}
