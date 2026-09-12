import 'server-only';

import type { AdapterFactory } from '../../core/adapter';
import { IndeterminateError, MaintenanceError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { ClassifiedStatus } from '../../core/status';
import { isValidS10TrackingNumber } from '../../core/detection';
import { explicitOffsetTime } from '../../core/time';
import {
  clean,
  decodeText,
  escapeRegExp,
  fetchBounded,
  parseJsonBytes,
  UpstreamHttpError,
} from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyCttStatus } from './status';

// Protocol provenance:
// - Prior art (full session mechanics + vocabulary, verified step by step
//   below, MIT): https://github.com/ha-parcel-integrations/ha-ctt (api.py,
//   parcels.py, tests).
// - CTT's tracker is an OutSystems Reactive app, so there is ceremony: the
//   endpoint answers 403 Invalid Login to a cookie-less request while setting
//   the nr2Users session cookie on that same response (the 403 is the
//   bootstrap, not an error); every data action then needs the cookie plus an
//   X-CSRFToken derived from it, plus moduleVersion/apiVersion tokens that CTT
//   rotates on every frontend deploy (derived at runtime from keyless version
//   endpoints and the screen bundle — never pinned). A browser User-Agent is
//   mandatory (Cloudflare error 1010 otherwise).
// - Live verification 2026-09-10, including a delivered parcel whose whole
//   history mapped: Found:true carries ObjectEventsFromQuery; Found:false is
//   BOTH genuine unknown and backend outage, told apart only via the sibling
//   DataActionCheckIPLocked call (made solely on Found:false — a found parcel
//   already proves health).
// - StateId is the stable integer key (never the Portuguese State text); the
//   map lives in status.ts.
const BASE_URL = 'https://appserver.ctt.pt';
const SCREEN_PATH = '/CustomerArea/screenservices/CustomerArea/CustomerArea/PublicArea_Detail';
const VIEW_NAME = 'CustomerArea.PublicArea_Detail';
const TRACK_ACTION = 'DataActionGetObjectEventsByInputObjectCode';
const MAINTENANCE_ACTION = 'DataActionCheckIPLocked';
const MODULE_VERSION_URL = `${BASE_URL}/CustomerArea/moduleservices/moduleversioninfo`;
const SCREEN_SCRIPT_PATH = '/CustomerArea/scripts/CustomerArea.CustomerArea.PublicArea_Detail.mvc.js';
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_SCRIPT_BYTES = 2_000_000;
const MAX_EVENTS_TO_RETURN = 20;

interface CttSession {
  cookie: string;
  csrfToken: string;
}

/** A CTT maintenance window: the backend is up but refuses to answer lookups. */
export class CttMaintenanceError extends MaintenanceError {
  constructor() {
    super('CTT', 'CTT tracking is temporarily unavailable');
    this.name = 'CttMaintenanceError';
  }
}

/** The OutSystems ceremony broke down (session, version tokens, body shape). */
export class CttApiError extends IndeterminateError {
  constructor(detail: string) {
    super('CTT', `CTT tracking request failed: ${detail}`);
    this.name = 'CttApiError';
  }
}

export function normalizeCttTrackingNumber(raw: string): string {
  // Mirrors number detection: checksum-valid S10 PT. Anything else stays with
  // the generic postal fallback — those routes were never sampled here.
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^[A-Z]{2}\d{9}PT$/.test(value) || !isValidS10TrackingNumber(value)) {
    throw new TypeError('CTT tracking requires a valid 13-character S10 number ending in PT');
  }
  return value;
}

export function cttTrackingUrl(rawTrackingNumber: string): string {
  // Legacy objectSearch page: the address users recognise, stable across
  // appserver host changes, and the one CTT itself links from its site.
  const url = new URL('https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx');
  url.searchParams.set('objects', normalizeCttTrackingNumber(rawTrackingNumber));
  return url.toString();
}

function sessionFromSetCookie(response: Response): CttSession | null {
  const getSetCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie.bind(response.headers)
    : null;
  const rawCookies = getSetCookie ? getSetCookie() : [];
  const header = rawCookies.find((value) => value.startsWith('nr2Users='))
    ?? response.headers.get('set-cookie') ?? '';
  const value = /^nr2Users=([^;]*)/.exec(header)?.[1] ?? '';
  if (!value) return null;
  // Decoded shape: crf=<TOKEN>;uid=0;unm= — the crf field is the CSRF token.
  const csrfToken = /crf=([^;]+)/.exec(decodeURIComponent(value))?.[1] ?? '';
  if (!csrfToken) return null;
  return { cookie: `nr2Users=${value}`, csrfToken };
}

export function parseCttTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizeCttTrackingNumber(trackingNumber);
  if (!isRecord(payload)) throw new SchemaError('CTT', 'CTT returned an invalid tracking response');
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) throw new SchemaError('CTT', 'CTT returned an invalid tracking response');
  const record = data.ObjectEventsFromQuery;
  if (!isRecord(record)) throw new SchemaError('CTT', 'CTT returned an invalid tracking response');
  const returned = clean(record.ObjectCode, 64).toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!returned) throw new SchemaError('CTT', 'CTT did not return a shipment identifier');
  if (returned !== requested) throw new SchemaError('CTT', 'CTT returned a different shipment');
  const rawEvents = record.Events;
  const eventsList = isRecord(rawEvents) && Array.isArray(rawEvents.List) ? rawEvents.List : null;
  if (eventsList === null) throw new SchemaError('CTT', 'CTT returned invalid tracking history');
  const parsed: Array<{ event: CarrierEvent; classified: ClassifiedStatus | undefined; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  eventsList.filter(isRecord).slice(0, 500).forEach((rawEvent, index) => {
    const stateId = typeof rawEvent.StateId === 'number' ? rawEvent.StateId : Number.NaN;
    const description = clean(rawEvent.Event, 500) || clean(rawEvent.State, 200);
    // Observed event datetimes carry explicit offsets; require them rather than
    // stamping a zone onto a cross-border lane.
    const time = explicitOffsetTime(rawEvent.DateTime);
    if (!time || !description) return;
    const identity = `${time.iso}\u0000${description}\u0000${Number.isSafeInteger(stateId) ? stateId : ''}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const classified = classifyCttStatus(stateId);
    parsed.push({
      // Local mixes depot codes and point names (operational locations, kept
      // coarse). Sender/recipient identity, contact and address blocks travel
      // on the record but are deliberately never retained.
      // An unmapped state keeps no stage: the sync classifies the wording and
      // records where the stage came from instead of assuming movement here.
      event: {
        time: time.iso,
        location: clean(rawEvent.Local, 160),
        description,
        ...(classified ? { stage: classified.stage } : {}),
        ...(Number.isSafeInteger(stateId) ? { provider_code: String(stateId) } : {}),
      },
      classified: classified ?? undefined,
      timestamp: time.timestamp,
      index,
    });
  });
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = parsed.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  const latest = parsed.find((item) => item.classified);
  if (!latest) {
    return {
      status: 'unknown',
      last_status_text: events[0]?.description ?? 'Tracking information received',
      last_update: events[0]?.time ?? null,
      expected_delivery: null,
      events,
    };
  }
  return {
    status: latest.classified!.status,
    current_stage: latest.classified!.stage,
    last_status_text: latest.event.description,
    last_update: latest.event.time ?? null,
    expected_delivery: null,
    events,
  };
}

export class CttTracker {
  readonly timeoutMs: number;
  readonly fetcher: typeof fetch | undefined;
  private moduleVersion: string | null = null;
  private apiVersions = new Map<string, string>();
  private screenScript: string | null = null;

  constructor(options: { timeoutMs?: number; fetcher?: typeof fetch } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('CTT timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizeCttTrackingNumber(rawTrackingNumber);
    const payload = await this.callAction(TRACK_ACTION, {
      ObjectCodeInput: trackingNumber,
      SearchInput: trackingNumber,
      IsFromPublicArea: true,
      IPClient: '',
    }, null, true, true);
    const record = isRecord(payload.data) ? payload.data.ObjectEventsFromQuery : undefined;
    if (!isRecord(record) || !record.Found) {
      // Found:false is both genuine unknown and backend outage: a found parcel
      // already proves health, so the sibling check runs solely on negatives.
      if (await this.isMaintenance()) throw new CttMaintenanceError();
      throw new NotFoundError('CTT');
    }
    return parseCttTrackingResponse(payload, trackingNumber);
  }

  private async isMaintenance(): Promise<boolean> {
    const payload = await this.callAction(MAINTENANCE_ACTION, {}, null, true, true);
    const data = isRecord(payload.data) ? payload.data : {};
    return data.IsMaintenance === true;
  }

  private async callAction(
    action: string,
    variables: Record<string, unknown>,
    session: CttSession | null,
    retrySession: boolean,
    retryVersion: boolean,
  ): Promise<{ data?: unknown; versionInfo?: unknown } & Record<string, unknown>> {
    const apiVersion = await this.ensureApiVersion(action);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': BROWSER_USER_AGENT,
    };
    if (session) {
      headers.Cookie = session.cookie;
      headers['X-CSRFToken'] = session.csrfToken;
    }
    const { response, bytes } = await fetchBounded(`${BASE_URL}${SCREEN_PATH}/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        versionInfo: { moduleVersion: this.moduleVersion, apiVersion },
        viewName: VIEW_NAME,
        screenData: { variables },
      }),
    }, {
      provider: 'CTT tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      retryTransient: true,
      allowHttpError: true,
      fetcher: this.fetcher,
    });
    if (response.status === 403) {
      const bootstrapped = sessionFromSetCookie(response);
      if (retrySession && bootstrapped) {
        return this.callAction(action, variables, bootstrapped, false, retryVersion);
      }
      throw new CttApiError('anonymous session bootstrap failed');
    }
    if (!response.ok) throw new UpstreamHttpError('CTT tracking', response.status);
    const payload = parseJsonBytes(bytes, 'CTT tracking');
    if (!isRecord(payload)) throw new CttApiError('unexpected body (not a JSON object)');
    const versionInfo = isRecord(payload.versionInfo) ? payload.versionInfo : {};
    if ((versionInfo.hasModuleVersionChanged === true || versionInfo.hasApiVersionChanged === true) && retryVersion) {
      this.moduleVersion = null;
      this.screenScript = null;
      this.apiVersions.delete(action);
      return this.callAction(action, variables, session, retrySession, false);
    }
    return payload;
  }

  private async ensureApiVersion(action: string): Promise<string> {
    const cached = this.apiVersions.get(action);
    if (cached !== undefined) return cached;
    await this.ensureModuleVersion();
    const script = await this.ensureScreenScript();
    const version = new RegExp(
      `callDataAction\\("${escapeRegExp(action)}",\\s*"[^"]*",\\s*"([^"]+)"`,
    ).exec(script)?.[1];
    if (!version) throw new CttApiError(`could not derive apiVersion for ${action}`);
    this.apiVersions.set(action, version);
    return version;
  }

  private async ensureModuleVersion(): Promise<void> {
    if (this.moduleVersion !== null) return;
    const { response, bytes } = await fetchBounded(MODULE_VERSION_URL, {
      headers: { Accept: 'application/json', 'User-Agent': BROWSER_USER_AGENT },
    }, {
      provider: 'CTT tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      retryTransient: true,
      allowHttpError: true,
      fetcher: this.fetcher,
    });
    if (!response.ok) throw new UpstreamHttpError('CTT tracking', response.status);
    const payload = parseJsonBytes(bytes, 'CTT tracking');
    const token = isRecord(payload) && typeof payload.versionToken === 'string' ? payload.versionToken : '';
    if (!token) throw new CttApiError('moduleversioninfo returned no versionToken');
    this.moduleVersion = token;
  }

  private async ensureScreenScript(): Promise<string> {
    if (this.screenScript !== null) return this.screenScript;
    // The version token carries +/= characters: it must travel percent-encoded
    // or the manifest endpoint answers an unrelated shape.
    const manifestUrl = `${BASE_URL}/CustomerArea/moduleservices/moduleinfo?${encodeURIComponent(this.moduleVersion ?? '')}`;
    const manifest = await this.fetchJson(manifestUrl);
    const versions = isRecord(manifest) && isRecord(manifest.manifest) && isRecord(manifest.manifest.urlVersions)
      ? manifest.manifest.urlVersions as Record<string, unknown>
      : {};
    const scriptToken = versions[SCREEN_SCRIPT_PATH];
    if (typeof scriptToken !== 'string' || !scriptToken) {
      throw new CttApiError("module manifest missing the screen script's version token");
    }
    const script = decodeText((await this.fetchBytes(`${BASE_URL}${SCREEN_SCRIPT_PATH}?${scriptToken}`)).bytes);
    this.screenScript = script;
    return script;
  }

  private async fetchJson(url: string): Promise<unknown> {
    return parseJsonBytes((await this.fetchBytes(url)).bytes, 'CTT tracking');
  }

  private async fetchBytes(url: string): Promise<{ bytes: Uint8Array }> {
    const { response, bytes } = await fetchBounded(url, {
      headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': BROWSER_USER_AGENT },
    }, {
      provider: 'CTT tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_SCRIPT_BYTES,
      retryTransient: true,
      allowHttpError: true,
      fetcher: this.fetcher,
    });
    if (!response.ok) throw new UpstreamHttpError('CTT tracking', response.status);
    return { bytes };
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new CttTracker({ fetcher: environment.fetcher });
  return {
    id: 'ctt',
    // The OutSystems session bootstrap and the version-token refresh are part
    // of the direct call, not separate tiers: they never change the transport.
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
