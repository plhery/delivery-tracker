import 'server-only';

import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { CarrierError, IndeterminateError, NotFoundError, SchemaError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps, type StepContext } from '../../core/runner';
import type { StepRecorder } from '../../core/telemetry';
import { explicitOffsetTime } from '../../core/time';
import { clean, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import { postiEventStage, postiStatus } from './status';

const TOKEN_URL = 'https://auth-service.posti.fi/api/v1/anonymous_token';
const GRAPHQL_URL = 'https://graphql.posti.fi/graphql';
const DEFAULT_TIMEOUT_MS = 15_000;

// The public tracking page uses this operation with PUBLIC_SHIPMENTS. Select
// only tracking fields; no account, recipient, address, payment or pickup code.
const QUERY = `query SearchShipments($searchTerms: [String!]!, $locale: String) {
  consumerSearchShipments(page: 1, pageSize: 20, type: PUBLIC_SHIPMENTS, searchTerms: $searchTerms, locale: $locale) {
    totalHits
    hits {
      displayId
      status { main subStatus }
      measurements { weight { unit value } height { unit value } width { unit value } length { unit value } }
      pickupPoint { address { publicName city } }
      events { city eventDescription reasonDescription timestamp }
      packages { trackingNumber }
    }
  }
}`;

export function normalizePostiTrackingNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^[A-Z0-9]{4,40}$/.test(number)) throw new TypeError('Posti requires a 4–40 character tracking number');
  return number;
}

class PostiSessionExpiredError extends CarrierError {
  constructor() {
    super('indeterminate', 'Posti', 'Posti anonymous session expired');
    this.name = 'PostiSessionExpiredError';
  }
}

function assertGraphql(payload: unknown): asserts payload is Record<string, unknown> {
  if (!isRecord(payload)) throw new SchemaError('Posti');
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    if (payload.errors.some((error) => isRecord(error) && error.errorType === 'Unauthorized')) {
      throw new PostiSessionExpiredError();
    }
    throw new IndeterminateError('Posti', 'Posti could not complete the tracking query');
  }
  if (payload.errors != null && !Array.isArray(payload.errors)) throw new SchemaError('Posti');
}

function measurement(raw: unknown, units: Record<string, number>): number | null {
  if (!isRecord(raw) || typeof raw.unit !== 'string' || !Object.hasOwn(units, raw.unit.toLowerCase())) return null;
  if (typeof raw.value !== 'number' && (typeof raw.value !== 'string' || !raw.value.trim())) return null;
  const value = Number(raw.value) * units[raw.unit.toLowerCase()];
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Identity-bound projection; empty search, malformed replies and wrong identities remain distinct. */
export function parse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizePostiTrackingNumber(trackingNumber);
  assertGraphql(payload);
  const search = isRecord(payload.data) ? payload.data.consumerSearchShipments : undefined;
  if (!isRecord(search) || !Number.isSafeInteger(search.totalHits) || Number(search.totalHits) < 0
    || !Array.isArray(search.hits)) throw new SchemaError('Posti');
  if (search.totalHits === 0 && search.hits.length === 0) throw new NotFoundError('Posti');
  if (search.hits.length === 0 || search.totalHits === 0) throw new SchemaError('Posti');
  const matches = search.hits.filter((hit) => isRecord(hit) && clean(hit.displayId, 64).toUpperCase() === requested);
  if (matches.length !== 1 || !isRecord(matches[0])) throw new SchemaError('Posti', 'Posti returned a different or ambiguous shipment');
  const hit = matches[0];
  if (!isRecord(hit.status) || typeof hit.status.main !== 'string'
    || !Array.isArray(hit.status.subStatus) || !hit.status.subStatus.every((code) => typeof code === 'string')
    || !Array.isArray(hit.events)) throw new SchemaError('Posti');
  // A group overview can contain several parcels. Do not attribute another
  // parcel's delivered scan to this identity.
  if (hit.packages != null && !Array.isArray(hit.packages)) throw new SchemaError('Posti');
  const packages = Array.isArray(hit.packages) ? hit.packages : [];
  if (packages.some((item) => !isRecord(item) || clean(item.trackingNumber, 64).toUpperCase() !== requested)) {
    throw new SchemaError('Posti', 'Posti returned a multi-parcel overview');
  }
  const events: CarrierEvent[] = hit.events.map((event): CarrierEvent => {
    if (!isRecord(event) || typeof event.eventDescription !== 'string') throw new SchemaError('Posti');
    const description = clean(event.eventDescription);
    return {
      description: [description, clean(event.reasonDescription)].filter(Boolean).join(' '),
      time: explicitOffsetTime(event.timestamp)?.iso ?? '',
      location: clean(event.city, 160),
      stage: postiEventStage(description),
    };
  }).sort((left, right) => (Date.parse(right.time || '') || 0) - (Date.parse(left.time || '') || 0)).slice(0, 100);
  const current = postiStatus(hit.status.main, hit.status.subStatus as string[]);
  const measurements = isRecord(hit.measurements) ? hit.measurements : {};
  const dimensions = ['length', 'width', 'height'].map((field) => measurement(measurements[field], { cm: 1, mm: 0.1, m: 100 }));
  const pickup = isRecord(hit.pickupPoint) && isRecord(hit.pickupPoint.address) ? hit.pickupPoint.address : {};
  return {
    status: current?.status ?? 'unknown',
    ...(current ? { current_stage: current.stage } : {}),
    last_status_text: events[0]?.description || hit.status.main,
    last_update: events[0]?.time || null,
    provider_status: hit.status.main,
    weight_kg: measurement(measurements.weight, { kg: 1, g: 0.001 }),
    dimensions_text: dimensions.every((value) => value !== null) ? `${dimensions.join(' × ')} cm` : null,
    pickup_point: [clean(pickup.publicName, 160), clean(pickup.city, 80)].filter(Boolean).join(', ') || null,
    timezone: 'Europe/Helsinki',
    events,
  };
}

interface Session { authorization: string; idToken: string; expiresAt: number }

function expiry(token: string): number {
  try {
    const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return isRecord(claims) && typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp * 1000 : 0;
  } catch { return 0; }
}

export class PostiTracker {
  private session?: Session;

  constructor(private readonly options: { fetcher?: typeof fetch; timeoutMs?: number; recorder?: StepRecorder } = {}) {}

  async fetch(trackingNumber: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizePostiTrackingNumber(trackingNumber);
    const budgetMs = context.budgetMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('Posti timeout must be positive');
    const deadline = performance.now() + budgetMs;
    const request = async (url: string, init: RequestInit, step: StepContext): Promise<unknown> => {
      step.signal.throwIfAborted();
      const { bytes } = await fetchBounded(url, init, {
        provider: 'Posti', maxBytes: 2_000_000,
        timeoutMs: Math.max(1, Math.floor(deadline - performance.now())),
        fetcher: (input, options) => (this.options.fetcher ?? fetch)(input, {
          ...options, signal: AbortSignal.any([step.signal, ...(options?.signal ? [options.signal] : [])]),
        }),
      });
      return parseJsonBytes(bytes, 'Posti');
    };
    const lookup = async (step: StepContext, refresh = false): Promise<CarrierResult> => {
      if (refresh || !this.session || this.session.expiresAt <= Date.now() + 30_000) {
        this.session = undefined;
        const token = await request(TOKEN_URL, { method: 'POST' }, step);
        const role = isRecord(token) && Array.isArray(token.role_tokens)
          ? token.role_tokens.find((value) => isRecord(value) && value.type === 'anonymous') : undefined;
        if (!isRecord(token) || typeof token.id_token !== 'string' || !token.id_token
          || !isRecord(role) || typeof role.token !== 'string' || !role.token) {
          throw new SchemaError('Posti', 'Posti returned an invalid anonymous session');
        }
        this.session = { authorization: role.token, idToken: token.id_token,
          expiresAt: Math.min(expiry(role.token), expiry(token.id_token)) };
      }
      const session = this.session;
      let payload: unknown;
      try {
        payload = await request(GRAPHQL_URL, {
          method: 'POST', headers: {
            'Content-Type': 'application/json', Accept: 'application/json',
            Authorization: session.authorization, 'X-Posti-Token': `Bearer ${session.idToken}`,
          },
          body: JSON.stringify({ operationName: 'SearchShipments', query: QUERY, variables: { searchTerms: [number], locale: 'en' } }),
        }, step);
      } catch (error) {
        if (error instanceof UpstreamHttpError && [401, 403].includes(error.status)) {
          if (this.session === session) this.session = undefined;
          throw new PostiSessionExpiredError();
        }
        throw error;
      }
      try { return parse(payload, number); }
      catch (error) {
        if (error instanceof PostiSessionExpiredError && this.session === session) this.session = undefined;
        throw error;
      }
    };
    return runSteps({ carrier: 'posti', budgetMs, signal: context.signal, recorder: this.options.recorder }, [
      { id: 'direct', run: (step) => lookup(step) },
      { id: 'refresh', recovers: (error) => error instanceof PostiSessionExpiredError, run: (step) => lookup(step, true) },
    ]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PostiTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'posti', steps: ['direct', 'refresh'], track: (input, context) => tracker.fetch(input.number, context) };
};
