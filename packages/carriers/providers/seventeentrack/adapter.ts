import 'server-only';

/**
 * 17TRACK (t.17track.net), a universal aggregator used as the last discovery
 * provider.
 *
 * Transport: the browser service loads the public tracking page and captures
 * the page's own `restapi` response; unsigned direct probes answer HTTP 200
 * with a rejection code instead of history (verified 2026-09-10). The parser
 * keeps only history whose shipment number equals the requested one, and turns
 * the provider's own rejection codes into typed errors so routing can tell a
 * verification wall from an outage.
 */
import type { AdapterFactory } from '../../core/adapter';
import { ChallengeError, SchemaError, TransportError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { StepRecorder } from '../../core/telemetry';
import type { TrawlClient } from '../../core/transport';
import { isRecord } from '../../core/types';
import { universalCarrierHints } from '../shared/hints';
import { capturedBodies, captureFailure, loadCapture, type CaptureSpec } from '../shared/capture';
import { event, numberOf, result, text, type UniversalSource } from '../shared/result';

const SOURCE: UniversalSource = '17TRACK';
const API_URL = 'https://t.17track.net/track/restapi';
/** Codes the provider returns when it wants an interactive verification. */
const VERIFICATION_CODES = [-11, -13, -14];
const MAX_PROVIDERS = 20;
const MAX_EVENTS = 1000;

/** The provider answered, but its lookup did not produce history for this shipment. */
export class SeventeenTrackLookupError extends TransportError {
  constructor(
    readonly reason: 'lookup_unavailable' | 'lookup_pending',
    readonly providerCode: number,
    readonly providerMessage?: string,
  ) {
    super(SOURCE, describeLookup(reason, providerCode, providerMessage));
    this.name = 'SeventeenTrackLookupError';
  }
}

/** The provider asked for an interactive verification the unattended lookup cannot pass. */
export class SeventeenTrackVerificationError extends ChallengeError {
  readonly reason = 'verification_required';

  constructor(readonly providerCode: number, readonly providerMessage?: string) {
    super(SOURCE, describeLookup('verification_required', providerCode, providerMessage));
    this.name = 'SeventeenTrackVerificationError';
  }
}

function describeLookup(reason: string, providerCode: number, providerMessage?: string): string {
  return `${SOURCE}: ${reason} (code ${providerCode}${providerMessage ? `: ${providerMessage}` : ''})`;
}

/** Both shapes of "17TRACK answered, but not with this shipment's history". */
export function isSeventeenTrackLookupError(error: unknown): error is SeventeenTrackLookupError | SeventeenTrackVerificationError {
  return error instanceof SeventeenTrackLookupError || error instanceof SeventeenTrackVerificationError;
}

function lookupError(code: number, providerMessage?: string): Error {
  return VERIFICATION_CODES.includes(code)
    ? new SeventeenTrackVerificationError(code, providerMessage)
    : new SeventeenTrackLookupError('lookup_unavailable', code, providerMessage);
}

export function parse17TrackResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = numberOf(trackingNumber);
  if (!isRecord(payload) || !isRecord(payload.meta) || !Number.isInteger(payload.meta.code)) {
    throw new SchemaError(SOURCE, '17TRACK lookup unavailable');
  }
  if (payload.meta.code !== 200) {
    const code = Number(payload.meta.code);
    // Keep the provider's short reason (e.g. for the intermittent code 400) visible in Sentry.
    const message = typeof payload.meta.message === 'string' ? text(payload.meta.message).slice(0, 120) : undefined;
    throw lookupError(code, message);
  }
  if (!Array.isArray(payload.shipments)) throw new SchemaError(SOURCE, '17TRACK lookup unavailable');
  const matches = payload.shipments.filter((s) => isRecord(s) && s.number === number);
  if (matches.length === 1 && isRecord(matches[0]) && Number.isInteger(matches[0].code) && matches[0].code !== 200) {
    // A shipment-level code is the lookup's own progress, never a verification wall.
    const code = Number(matches[0].code);
    throw new SeventeenTrackLookupError(code === 100 ? 'lookup_pending' : 'lookup_unavailable', code);
  }
  if (matches.length !== 1 || !isRecord(matches[0]) || matches[0].code !== 200 || !isRecord(matches[0].shipment)) {
    throw new SchemaError(SOURCE, '17TRACK has no matching shipment history');
  }
  const shipment = matches[0].shipment;
  const tracking = shipment.tracking;
  if (!isRecord(tracking) || !Array.isArray(tracking.providers) || tracking.providers.length > MAX_PROVIDERS) {
    throw new SchemaError(SOURCE, '17TRACK returned invalid providers');
  }
  const events: CarrierEvent[] = [];
  let count = 0;
  for (const provider of tracking.providers) {
    if (!isRecord(provider) || !Array.isArray(provider.events)) continue;
    for (const raw of provider.events) {
      if (++count > MAX_EVENTS || !isRecord(raw)) throw new SchemaError(SOURCE, '17TRACK returned invalid events');
      const parsed = event(raw.time_utc ?? raw.time_iso, raw.description, raw.stage);
      if (parsed) events.push(parsed);
    }
  }
  return { ...result(events, SOURCE), ...universalCarrierHints(tracking.providers.map((provider) =>
    isRecord(provider) && isRecord(provider.provider) ? provider.provider.name : undefined)) };
}

export interface SeventeenTrackOptions {
  trawl?: TrawlClient | null;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
  timeoutMs?: number;
}

export class SeventeenTrackTracker {
  constructor(readonly options: SeventeenTrackOptions = {}) {}

  async fetch(trackingNumber: string, budgetMs = this.options.timeoutMs ?? 30_000): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    const spec = (remainingMs: number): CaptureSpec => ({
      source: SOURCE, url: `https://t.17track.net/en#nums=${number}`, apiUrl: API_URL,
      budgetMs: remainingMs, fetcher: this.options.fetcher,
    });
    return runSteps({ carrier: SOURCE, budgetMs, recorder: this.options.recorder }, [{
      id: 'trawl',
      run: async ({ remainingMs }) => {
        const capture = spec(remainingMs);
        const page = await loadCapture(this.options.trawl ?? null, capture);
        let pending: Error | undefined;
        for (const body of capturedBodies(page, capture)) {
          try {
            return parse17TrackResponse(JSON.parse(body), number);
          } catch (error) {
            // Continue past polling replies and unrelated/demo numbers, but retain
            // the latest structured failure if no matching history follows.
            if (isSeventeenTrackLookupError(error)) pending ??= error;
          }
        }
        throw pending ?? captureFailure(page, capture);
      },
    }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new SeventeenTrackTracker({
    trawl: environment.trawl, fetcher: environment.fetcher, recorder: environment.recorder,
  });
  return {
    id: SOURCE,
    steps: ['trawl'],
    track: (input, context) => tracker.fetch(input.number, context?.budgetMs),
  };
};
