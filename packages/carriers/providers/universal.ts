import 'server-only';

/**
 * The universal discovery chain: what runs when no dedicated carrier adapter
 * can answer for a parcel.
 *
 * Order is Ship24 -> ParcelsApp -> 17TRACK, with Postal Ninja inserted before
 * 17TRACK only when the host enables it. Each provider is asked once per
 * lookup and the first usable history wins; the per-parcel router remembers
 * which provider answered, so this order is only the starting point. The
 * source names are persisted in routing state and must not change.
 *
 * This module owns the order and the aggregate failure; every protocol detail
 * lives in the provider folder next to it.
 */
import type { AdapterEnvironment, CarrierAdapter } from '../core/adapter';
import type { CarrierResult } from '../core/result';
import { NOOP_RECORDER } from '../core/telemetry';
import { TrawlClient } from '../core/transport';
import { adapter as parcelsAppAdapter } from './parcelsapp/adapter';
import { adapter as postalNinjaAdapter } from './postal-ninja/adapter';
import { adapter as seventeenTrackAdapter } from './seventeentrack/adapter';
import { adapter as ship24Adapter } from './ship24/adapter';
import { numberOf, type UniversalSource as Source } from './shared/result';

export { parse17TrackResponse, SeventeenTrackLookupError, SeventeenTrackVerificationError } from './seventeentrack/adapter';
export { parseParcelsAppHtml, parseParcelsAppResponse } from './parcelsapp/adapter';
export { parsePostalNinjaResponse } from './postal-ninja/adapter';
export { parseShip24Response } from './ship24/adapter';
export { TrackingCaptureError } from './shared/capture';
export type { UniversalSource } from './shared/result';

export const UNIVERSAL_SOURCES: Source[] = ['Ship24', 'ParcelsApp', '17TRACK'];
export function universalSources(enablePostalNinja = false): Source[] {
  return enablePostalNinja ? ['Ship24', 'ParcelsApp', 'Postal Ninja', '17TRACK'] : [...UNIVERSAL_SOURCES];
}

const FACTORIES = {
  'Ship24': ship24Adapter,
  'ParcelsApp': parcelsAppAdapter,
  'Postal Ninja': postalNinjaAdapter,
  '17TRACK': seventeenTrackAdapter,
} as const satisfies Record<Source, unknown>;

interface SourceFailure {
  source: Source;
  reason: string;
  error: unknown;
}

export class UniversalTrackingError extends AggregateError {
  constructor(readonly failures: ReadonlyArray<SourceFailure>) {
    super(failures.map(({ error }) => error), `Automatic carrier lookup could not retrieve tracking history. ${failures.map(
      ({ source, reason }) => `${source}: ${reason}`,
    ).join('; ')}`);
    this.name = 'UniversalTrackingError';
  }
}

export interface UniversalTrackerOptions {
  /** The browser service endpoint; overrides `environment.trawl`. An empty string disables it. */
  trawlUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  executablePath?: string;
  enablePostalNinja?: boolean;
  /** Test seam replacing the two local-browser providers. */
  browserLookup?: (source: 'Postal Ninja' | 'Ship24', number: string) => Promise<CarrierResult>;
  /** What the host gives every adapter: browser service, telemetry sink, flags. */
  environment?: Partial<AdapterEnvironment>;
}

export class UniversalTracker {
  constructor(readonly options: UniversalTrackerOptions = {}) {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new TypeError('Universal tracking timeout must be positive');
    }
  }

  /**
   * Look up one number through the whole chain. `postcode` is the parcel's
   * stored delivery postcode, if the user supplied one: it is forwarded into
   * every provider's track input. ParcelsApp submits it as extra[zipcode] on
   * its direct API request; the other providers currently do not consume it.
   */
  async fetch(trackingNumber: string, postcode?: string | null): Promise<CarrierResult> {
    numberOf(trackingNumber);
    const failures: SourceFailure[] = [];
    const sources = universalSources(this.options.enablePostalNinja);
    for (const source of sources) {
      try { return await this.fetchSource(source, trackingNumber, undefined, postcode); }
      catch (error) { failures.push({ source, reason: 'history unavailable; try again later or open the tracking website', error }); }
    }
    throw new UniversalTrackingError(failures);
  }

  async fetchSource(source: Source, trackingNumber: string, timeoutMs = this.options.timeoutMs ?? 30_000, postcode?: string | null): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    if (this.options.browserLookup && (source === 'Postal Ninja' || source === 'Ship24')) {
      return await this.options.browserLookup(source, number);
    }
    return await this.provider(source).track({ number, postcode: postcode ?? null }, { budgetMs: timeoutMs });
  }

  /** One provider adapter, built from this tracker's environment. */
  private provider(source: Source): CarrierAdapter {
    return FACTORIES[source](this.environment());
  }

  private environment(): AdapterEnvironment {
    const partial = this.options.environment ?? {};
    const fetcher = partial.fetcher ?? this.options.fetcher;
    return {
      fetcher,
      trawl: this.trawl(fetcher, partial),
      browserExecutablePath: partial.browserExecutablePath ?? this.options.executablePath ?? null,
      recorder: partial.recorder ?? NOOP_RECORDER,
      env: partial.env ?? process.env,
    };
  }

  private trawl(fetcher: typeof fetch | undefined, partial: Partial<AdapterEnvironment>): TrawlClient | null {
    const configured = this.options.trawlUrl;
    if (configured !== undefined) return configured ? new TrawlClient(configured, fetcher) : null;
    if (partial.trawl !== undefined) return partial.trawl;
    return TrawlClient.fromEnvironment(process.env, fetcher);
  }
}
