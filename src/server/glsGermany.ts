import 'server-only';

import { fetchBounded, parseJsonBytes, UpstreamHttpError } from './boundedFetch';
import type { CarrierResult } from './carrierResult';
import {
  glsSwitzerlandDetailApiUrl,
  glsDeliveryReference,
  glsSwitzerlandOverviewApiUrl,
  GLSSwitzerlandTrackingError,
  normalizeGLSSwitzerlandPostcode,
  normalizeGLSSwitzerlandTrackingNumber,
  parseGLSSwitzerlandTrackingResponse,
  selectGLSParcel,
} from './glsSwitzerland';
import { isRecord } from './types';

// GLS's GROUP recipient service covers German and Swiss parcels. Keep the
// shared response parser; the delivery postcode can be Swiss or German.
const PROVIDER = 'GLS Germany tracking';

export class GLSGermanyTrackingError extends Error {
  readonly status = 404;

  constructor() {
    super('GLS Germany could not locate the shipment');
    this.name = 'GLSGermanyTrackingError';
  }
}

export class GLSGermanyTracker {
  constructor(readonly timeoutMs = 15_000, readonly now: () => number = Date.now) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('GLS Germany timeout must be positive');
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
      throw new TypeError('GLS Germany returned an invalid overview');
    }
    const parcel = selectGLSParcel(overview, number);
    if (!parcel || !/^\d{11,14}$/.test(String(parcel.tuNo))) {
      throw new TypeError('GLS Germany did not return a numeric parcel number');
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
    }, { provider: PROVIDER, timeoutMs: this.timeoutMs, maxBytes: 1_000_000, allowHttpError: true });
    // A challenge, invalid postcode, rate limit or outage must not become "not found".
    if (response.status === 404) {
      const payload = parseJsonBytes(bytes, PROVIDER);
      if (isRecord(payload) && payload.lastError === 'E000') throw new GLSGermanyTrackingError();
    }
    if (!response.ok) throw new UpstreamHttpError(PROVIDER, response.status);
    return parseJsonBytes(bytes, PROVIDER);
  }
}
