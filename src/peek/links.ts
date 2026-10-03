import type {
  ApiCarrierDetectionResponse,
  ApiClaimParcelsRequest,
  ApiClaimParcelsResponse,
  ApiDeleteParcelAlertRequest,
  ApiParcelAlertRequest,
  ApiParcelShareResponse,
  ApiPublicLookupRequest,
  ApiPublicLookupResponse,
  ApiPublicParcelResponse,
  ApiShareParcelRequest,
  ApiUpdateParcelLinkRequest,
} from '../generated/apiContract';
import type { Locale } from '../i18n';
import { authenticatedFetch, type ApiAuth } from '../lib/apiClient';
import { isDemoBuild } from '../lib/buildMode';
import { CARRIERS, detectCarrier, normalizeTrackingNumber } from '../lib/carriers';
import { userErrorKey } from '../lib/userMessages';
import { createDemoLinks } from './demoLinks';
import {
  isParcelLinkId,
  ParcelLinkError,
  parcelLinkView,
  type CarrierAnswer,
  type ParcelAlertInput,
  type ParcelClaim,
  type ParcelClaimResult,
  type ParcelLinkChanges,
  type ParcelLinkRead,
  type ParcelLinkReadOptions,
  type ParcelLinksClient,
  type ParcelLinkView,
  type ParcelLookup,
  type ParcelLookupInput,
  type ParcelShare,
  type ParcelShareClient,
} from './linkModel';
import { SAMPLE_LINK_ID } from './sample';
import { readSampleLink, restartSample } from './sampleLink';

export * from './linkModel';
export { createDemoLinks, DEMO_LINKS_STORAGE_KEY } from './demoLinks';

const OWNER_KEY = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_TIMEOUT_MS = 30_000;
/** When a refusal names no delay. */
const DEFAULT_RETRY_SECONDS = 60;

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return null;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1_000);
  return Number.isFinite(seconds) ? Math.max(1, seconds) : null;
}

/** Every answer that is not a success becomes one typed failure; the response itself never escapes. */
async function failure(response: Response): Promise<ParcelLinkError> {
  const payload = await response.json().catch(() => null) as { error?: unknown; scope?: unknown } | null;
  const message = typeof payload?.error === 'string' ? payload.error : undefined;
  const retry = retryAfterSeconds(response);
  if (response.status === 404) return new ParcelLinkError('unavailable');
  if (response.status === 410) return new ParcelLinkError('stopped');
  if (response.status === 409) return new ParcelLinkError('full', { message });
  if (response.status === 429) {
    return new ParcelLinkError(payload?.scope === 'daily' ? 'daily' : 'burst', {
      message, retryAfterSeconds: retry ?? DEFAULT_RETRY_SECONDS,
    });
  }
  // The server's wording picks advice the app already has; the wording itself stays out of the screen.
  const guidance = message ? userErrorKey(new Error(message)) : null;
  const kind = response.status === 400 ? 'validation'
    : response.status === 503 && /not configured/i.test(message ?? '') ? 'unconfigured' : 'server';
  return new ParcelLinkError(kind, { message, guidance, retryAfterSeconds: retry });
}

async function answer<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') throw new ParcelLinkError('server', { message: 'Unreadable answer' });
  return payload as T;
}

/**
 * Parcel links through the public API. The requests carry no cookie, no
 * referrer and no sign-in: the link id is the capability, and the owner key
 * goes along only when this device holds it.
 */
export function createApiLinks(request: typeof fetch = (input, init) => fetch(input, init)): ParcelLinksClient {
  async function send(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return await request(path, {
        ...init,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (error) {
      // The caller's own cancellation is not a failure to report.
      if (signal?.aborted) throw error;
      throw new ParcelLinkError('offline', { cause: error });
    }
  }
  const keyHeader = (key: string | null | undefined): Record<string, string> | undefined =>
    key && OWNER_KEY.test(key) ? { 'X-Parcel-Key': key } : undefined;
  const write = (method: string, path: string, body: unknown, signal?: AbortSignal, key?: string | null) => send(path, {
    method, headers: { 'Content-Type': 'application/json', ...keyHeader(key) }, body: JSON.stringify(body),
  }, signal);
  const post = (path: string, body: unknown, signal?: AbortSignal) => write('POST', path, body, signal);

  return {
    mode: 'api',

    async detectCarrierPublic(number, signal) {
      const trackingNumber = normalizeTrackingNumber(number);
      const response = await post('/api/public/detect', { trackingNumber }, signal);
      if (!response.ok) throw await failure(response);
      const result = await answer<ApiCarrierDetectionResponse>(response);
      if (result.trackingNumber !== trackingNumber || !Object.hasOwn(CARRIERS, result.carrier)
        || (result.carrier === 'amazon-shipping' && !['available', 'expired'].includes(result.amazonShippingStatus ?? ''))) {
        throw new ParcelLinkError('server', { message: 'Unreadable carrier answer' });
      }
      return result;
    },

    async lookupParcel(input, signal) {
      // Named fields only: whatever else the caller holds, a name included, stays on the device.
      const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
      const body: ApiPublicLookupRequest = {
        trackingNumber,
        // Like adding to an account: the carrier the number's shape says, unless one was chosen.
        carrier: input.carrier ?? detectCarrier(trackingNumber),
        ...(input.trackingUrl?.trim() ? { trackingUrl: input.trackingUrl.trim() } : {}),
        ...(input.dpdPostcode?.trim() ? { dpdPostcode: input.dpdPostcode.trim() } : {}),
      };
      const response = await post('/api/public/parcels', body, signal);
      if (!response.ok) throw await failure(response);
      const result = await answer<ApiPublicLookupResponse>(response);
      const view = parcelLinkView(result);
      if (typeof result.key !== 'string' || !OWNER_KEY.test(result.key)) {
        throw new ParcelLinkError('server', { message: 'Unreadable parcel link answer' });
      }
      return { id: view.link.id, key: result.key, view };
    },

    async readParcelLink(id, { key, signal, tellStopped = false } = {}) {
      // A malformed id is a link that leads nowhere; it is not worth a request.
      if (!isParcelLinkId(id)) return 'unavailable';
      const response = await send(`/api/public/parcels/${id}`, { headers: keyHeader(key) }, signal);
      if (response.status === 404 || (response.status === 410 && !tellStopped)) return 'unavailable';
      if (!response.ok) throw await failure(response);
      return parcelLinkView(await answer<ApiPublicParcelResponse>(response));
    },

    async forgetParcelLink(id, key) {
      if (!isParcelLinkId(id) || !OWNER_KEY.test(key)) throw new ParcelLinkError('unavailable');
      const response = await send(`/api/public/parcels/${id}`, { method: 'DELETE', headers: keyHeader(key) });
      if (!response.ok) throw await failure(response);
    },

    async updateParcelLink(id, key, changes, signal) {
      if (!isParcelLinkId(id) || !OWNER_KEY.test(key)) throw new ParcelLinkError('unavailable');
      // Named switches only: a name or a gift note is never part of it.
      const body: ApiUpdateParcelLinkRequest = {
        ...(typeof changes.showNumber === 'boolean' ? { showNumber: changes.showNumber } : {}),
        ...(typeof changes.gift === 'boolean' ? { gift: changes.gift } : {}),
        ...(typeof changes.shared === 'boolean' ? { shared: changes.shared } : {}),
      };
      const response = await write('PATCH', `/api/public/parcels/${id}`, body, signal, key);
      if (!response.ok) throw await failure(response);
      return parcelLinkView(await answer<ApiPublicParcelResponse>(response));
    },

    async setParcelAlert(id, alert, key) {
      if (!isParcelLinkId(id)) throw new ParcelLinkError('unavailable');
      const { endpoint, keys } = alert.subscription;
      const body: ApiParcelAlertRequest = {
        subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, preset: alert.preset, locale: alert.locale,
      };
      const response = await write('PUT', `/api/public/parcels/${id}/alerts`, body, undefined, key);
      if (!response.ok) throw await failure(response);
    },

    async removeParcelAlert(id, endpoint) {
      // A link that cannot exist has no alert to remove.
      if (!isParcelLinkId(id)) return;
      const body: ApiDeleteParcelAlertRequest = { endpoint };
      const response = await write('DELETE', `/api/public/parcels/${id}/alerts`, body);
      if (!response.ok) throw await failure(response);
    },
  };
}

function shareLink(value: unknown): ParcelShare | null {
  if (!value || typeof value !== 'object') return null;
  const link = value as Partial<ParcelShare>;
  if (!isParcelLinkId(link.id)) throw new ParcelLinkError('server', { message: 'Unreadable share answer' });
  return { id: link.id, showNumber: link.showNumber === true, gift: link.gift === true, createdAt: String(link.createdAt ?? '') };
}

/**
 * Sharing one of the signed-in account's parcels through a parcel link.
 * Always the API. An expired sign-in fails as it does everywhere else in the
 * app, with `ApiAuthenticationError`.
 */
export function createAccountShare(auth: ApiAuth): ParcelShareClient {
  async function call(packageId: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await authenticatedFetch(`/api/packages/${encodeURIComponent(packageId)}/share`, auth, init);
    } catch (error) {
      if (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')) {
        throw new ParcelLinkError('offline', { cause: error });
      }
      throw error;
    }
    if (!response.ok) throw await failure(response);
    return response;
  }
  return {
    async current(parcelId) {
      return shareLink((await answer<ApiParcelShareResponse>(await call(parcelId, {}))).link);
    },
    async share(parcel, changes = {}) {
      const body: ApiShareParcelRequest = {
        ...(typeof changes.showNumber === 'boolean' ? { showNumber: changes.showNumber } : {}),
        ...(typeof changes.gift === 'boolean' ? { gift: changes.gift } : {}),
      };
      const link = shareLink((await answer<ApiParcelShareResponse>(await call(parcel.id, { method: 'PUT', body: JSON.stringify(body) }))).link);
      if (!link) throw new ParcelLinkError('server', { message: 'Unreadable share answer' });
      return link;
    },
    async stop(parcelId) {
      await call(parcelId, { method: 'DELETE' });
    },
  };
}

/** Chosen once: the API where the build has one, this browser's demo where it has none. */
const demo = isDemoBuild ? createDemoLinks() : null;
const client: ParcelLinksClient = demo ?? createApiLinks();

/** Whether lookups stay in this browser (`demo`) or go to the server (`api`). */
export const parcelLinksMode = client.mode;

/** Sharing the demo deliveries' parcels, in a build without an API: their links live in this browser. */
export const demoAccountShare: ParcelShareClient | null = demo?.accountShare ?? null;

/** Which carrier a number belongs to, asked before anyone signs in. */
export function detectCarrierPublic(trackingNumber: string, signal?: AbortSignal): Promise<CarrierAnswer> {
  return client.detectCarrierPublic(trackingNumber, signal);
}

/** Follows one parcel without an account. The owner key in the answer is given this once. */
export function lookupParcel(input: ParcelLookupInput, signal?: AbortSignal): Promise<ParcelLookup> {
  return client.lookupParcel(input, signal);
}

/**
 * Reads a parcel through its link: as its owner with the key, as a viewer
 * without. A link whose sharing was stopped reads as unavailable, unless
 * `tellStopped` asks for the `stopped` failure a parcel page tells apart.
 */
export function readParcelLink(id: string, options?: ParcelLinkReadOptions): Promise<ParcelLinkRead> {
  // The sample is told by the browser, in every build.
  return id === SAMPLE_LINK_ID ? readSampleLink(options) : client.readParcelLink(id, options);
}

/** Opens the sample parcel at the beginning of its story, told in the reader's language. */
export function startSample(locale: Locale): Promise<ParcelLinkView> {
  restartSample();
  return readSampleLink({ locale });
}

/** Forgets a lookup on the server. Only the owner key can. */
export function forgetParcelLink(id: string, key: string): Promise<void> {
  return client.forgetParcelLink(id, key);
}

/** Changes what a looked-up parcel's link shows. Only the owner key can; the answer is the owner's view. */
export function updateParcelLink(id: string, key: string, changes: ParcelLinkChanges, signal?: AbortSignal): Promise<ParcelLinkView> {
  return client.updateParcelLink(id, key, changes, signal);
}

/** Turns a browser's alerts on for a link, or changes what they announce. */
export function setParcelAlert(id: string, alert: ParcelAlertInput, key?: string | null): Promise<void> {
  // The sample's alert is this browser's note alone.
  return id === SAMPLE_LINK_ID ? Promise.resolve() : client.setParcelAlert(id, alert, key);
}

/** Turns a browser's alerts off for a link. */
export function removeParcelAlert(id: string, endpoint: string): Promise<void> {
  return id === SAMPLE_LINK_ID ? Promise.resolve() : client.removeParcelAlert(id, endpoint);
}

/**
 * Keeps looked-up parcels in the signed-in account. Always the API: the demo
 * has no accounts. An expired sign-in fails as it does everywhere else in the
 * app, with `ApiAuthenticationError`.
 */
export async function claimParcelLinks(links: ParcelClaim[], auth: ApiAuth, signal?: AbortSignal): Promise<ParcelClaimResult[]> {
  const body: ApiClaimParcelsRequest = {
    links: links.map(({ id, key, label }) => ({
      id,
      ...(key ? { key } : {}),
      ...(label?.trim() ? { label: label.trim() } : {}),
    })),
  };
  let response: Response;
  try {
    response = await authenticatedFetch('/api/packages/claim', auth, { method: 'POST', body: JSON.stringify(body), signal });
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')) {
      throw new ParcelLinkError('offline', { cause: error });
    }
    throw error;
  }
  if (!response.ok) throw await failure(response);
  const { results } = await answer<ApiClaimParcelsResponse>(response);
  if (!Array.isArray(results)) throw new ParcelLinkError('server', { message: 'Unreadable claim answer' });
  return results;
}
