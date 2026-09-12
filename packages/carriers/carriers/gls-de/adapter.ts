import 'server-only';

import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError, UpstreamHttpError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import {
  glsSwitzerlandDetailApiUrl,
  glsDeliveryReference,
  glsSwitzerlandOverviewApiUrl,
  GLSSwitzerlandTrackingError,
  normalizeGLSSwitzerlandPostcode,
  normalizeGLSSwitzerlandTrackingNumber,
  parseGLSSwitzerlandTrackingResponse,
  selectGLSParcel,
} from '../gls-ch/adapter';

// GLS's GROUP recipient service covers German and Swiss parcels. Keep the
// shared response parser; the delivery postcode can be Swiss or German.
const PROVIDER = 'GLS Germany tracking';
const CARRIER = 'GLS Germany';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface GLSGermanyOptions {
  timeoutMs?: number;
  now?: () => number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

/** Kept as a named class: the host's grouped live suite asserts this error's name. */
export class GLSGermanyTrackingError extends NotFoundError {
  constructor() {
    super(CARRIER);
    this.name = 'GLSGermanyTrackingError';
  }
}

export class GLSGermanyTracker {
  readonly timeoutMs: number;
  readonly now: () => number;
  readonly #fetcher: typeof fetch | undefined;

  constructor(options: number | GLSGermanyOptions = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now, fetcher } = typeof options === 'number'
      ? { timeoutMs: options, now: Date.now, fetcher: undefined }
      : options;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('GLS Germany timeout must be positive');
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.#fetcher = fetcher;
  }

  async fetch(rawTrackingNumber: string, rawPostcode: string): Promise<CarrierResult> {
    const number = normalizeGLSSwitzerlandTrackingNumber(rawTrackingNumber);
    const postcode = normalizeGLSSwitzerlandPostcode(rawPostcode, '4,5');
    const overview = await this.request(glsSwitzerlandOverviewApiUrl(number, this.now()));
    // Validate the overview identity before resolving a Track ID to a parcel number.
    try {
      parseGLSSwitzerlandTrackingResponse(overview, number);
    } catch (error) {
      if (error instanceof GLSSwitzerlandTrackingError) throw new GLSGermanyTrackingError();
      throw error;
    }
    if (!isRecord(overview) || !Array.isArray(overview.tuStatus)) {
      throw new SchemaError(CARRIER, 'GLS Germany returned an invalid overview');
    }
    const parcel = selectGLSParcel(overview, number);
    if (!parcel || !/^\d{11,14}$/.test(String(parcel.tuNo))) {
      throw new SchemaError(CARRIER, 'GLS Germany did not return a numeric parcel number');
    }
    const owners = Array.isArray(parcel.owners) ? parcel.owners.filter(isRecord) : [];
    const owner = owners.find((row) => row.type === 'REQUEST');
    const detail = await this.request(glsSwitzerlandDetailApiUrl(
      String(parcel.tuNo), postcode, this.now(), String(owner?.code ?? ''), '4,5',
    ));
    try {
      const result = parseGLSSwitzerlandTrackingResponse(detail, String(parcel.tuNo));
      // Both services use CET/CEST; expose the regional timezone to clients.
      return { ...result, ...glsDeliveryReference(parseGLSSwitzerlandTrackingResponse(overview, number)), timezone: 'Europe/Berlin' };
    } catch (error) {
      if (error instanceof GLSSwitzerlandTrackingError) throw new GLSGermanyTrackingError();
      throw error;
    }
  }

  /**
   * Whether GLS Germany itself recognizes an ambiguous numeric shape. Used by
   * the host's carrier-detection route, which promotes a number to `gls-de`
   * only after this returns true; a provider failure must stay a failure.
   */
  async recognizes(rawTrackingNumber: string): Promise<boolean> {
    const number = normalizeGLSSwitzerlandTrackingNumber(rawTrackingNumber);
    try {
      const url = glsSwitzerlandOverviewApiUrl(number, this.now()).replace('/GROUP/en/', '/DE/en/');
      const overview = await this.request(url);
      const result = parseGLSSwitzerlandTrackingResponse(overview, number);
      return result.status !== 'unknown';
    } catch (error) {
      if (error instanceof GLSGermanyTrackingError || error instanceof GLSSwitzerlandTrackingError) return false;
      throw error;
    }
  }

  private async request(url: string): Promise<unknown> {
    const { response, bytes } = await fetchBounded(url, {
      headers: { Accept: 'application/json', Referer: 'https://gls-group.eu/EU/en/parcel-tracking' },
    }, {
      provider: PROVIDER,
      timeoutMs: this.timeoutMs,
      maxBytes: 1_000_000,
      allowHttpError: true,
      ...(this.#fetcher ? { fetcher: this.#fetcher } : {}),
    });
    // A challenge, invalid postcode, rate limit or outage must not become "not found".
    if (response.status === 404) {
      const payload = parseJsonBytes(bytes, PROVIDER);
      if (isRecord(payload) && payload.lastError === 'E000') throw new GLSGermanyTrackingError();
    }
    if (!response.ok) throw new UpstreamHttpError(PROVIDER, response.status);
    return parseJsonBytes(bytes, PROVIDER);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new GLSGermanyTracker({ fetcher: environment.fetcher });
  return {
    id: 'gls-de',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number, input.postcode ?? ''),
  };
};
