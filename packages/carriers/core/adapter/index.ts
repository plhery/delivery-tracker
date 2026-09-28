/**
 * The contract between the host and a carrier adapter.
 *
 * A carrier folder exports an `AdapterFactory`; the generated registry lists
 * every factory by carrier id, and the host creates one adapter instance per
 * process through an `AdapterRegistry`. An adapter owns its sessions and
 * declares its steps; it reaches the network only through what the
 * `AdapterEnvironment` provides, and it reports through the `StepRecorder`.
 */
import { carrierErrorKind } from '../errors';
import type { CarrierResult } from '../result';
import type { StepRecorder } from '../telemetry';
import type { TrawlClient } from '../transport/trawl';
import { explicitOffsetTime } from '../time';

export interface TrackingInput {
  /** The tracking number as stored on the parcel, validated at the API boundary. */
  number: string;
  /** A capability URL for carriers that need one (shared Planzer links, Dachser). */
  trackingUrl?: string | null;
  /** The delivery postcode for carriers that need one; part of the tracking credential. */
  postcode?: string | null;
  /**
   * The zone of the carrier the parcel is filed under, for universal providers
   * whose scan times name no zone they can be trusted with. When that
   * carrier's catalog zone is UTC, the zone of the carrier a direct lookup
   * confirmed for the same number. Never a guess: absent when neither has one.
   */
  timezone?: string | null;
}

export interface TrackingContext {
  signal?: AbortSignal;
  /** Overrides the adapter's default lookup budget. */
  budgetMs?: number;
}

export interface AdapterEnvironment {
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
  /** The private browser service, or null when not configured. */
  trawl: TrawlClient | null;
  /** A Chromium executable for adapters that must run a browser locally, or null. */
  browserExecutablePath: string | null;
  recorder: StepRecorder;
  /** Provider-specific configuration (feature flags, optional endpoints). */
  env: Readonly<Record<string, string | undefined>>;
}

/** Whether a carrier knows a tracking number, from a cheap check. */
export interface Recognition {
  known: boolean;
  /** The newest activity the check saw, when it reports one; old parcels can share a reused number. */
  lastActivityAt?: string | null;
}

export interface CarrierAdapter {
  readonly id: string;
  /** The tiers this adapter can go through, in order; telemetry labels use these ids. */
  readonly steps: readonly string[];
  track(input: TrackingInput, context?: TrackingContext): Promise<CarrierResult>;
  /**
   * Required when carrier.json declares `tracking.recognition`: whether the
   * carrier knows the number, without the user's inputs, through plain HTTP
   * only (never a browser tier). A positive not-found is `known: false`; any
   * other failure throws.
   */
  recognize?(number: string, context?: TrackingContext): Promise<Recognition>;
}

export type AdapterFactory = (environment: AdapterEnvironment) => CarrierAdapter;

/**
 * `recognize()` for an adapter whose ordinary lookup is already cheap: a
 * result with scans, or a status past pending, is known; a positive not-found
 * is unknown; any other failure is thrown. `accepts` is the adapter's own
 * number check: a form it cannot look up is unknown without a request. Only
 * for lookups without a browser tier.
 */
/** Whether a number check passes: false when it throws its TypeError. */
export function accepted(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

export async function recognizeFromLookup(
  lookup: () => Promise<CarrierResult>,
  accepts: () => boolean = () => true,
): Promise<Recognition> {
  if (!accepts()) return { known: false };
  let result: CarrierResult;
  try {
    result = await lookup();
  } catch (error) {
    if (carrierErrorKind(error) === 'not_found') return { known: false };
    throw error;
  }
  // Local clocks and malformed dates cannot rank reuse of a tracking number.
  const iso = (value: string | null | undefined) => {
    if (typeof value !== 'string') return Number.NaN;
    const raw = value.trim();
    // Luxon normalizes impossible offsets such as +02:99 or +99:00.
    // Those are unresolved clocks, not instants that can rank a match.
    return /^\d{4}-\d{2}-\d{2}T/.test(raw) && /(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/i.test(raw)
      ? explicitOffsetTime(raw)?.timestamp ?? Number.NaN : Number.NaN;
  };
  const times = (result.events ?? []).map((event) => iso(event.time)).filter(Number.isFinite);
  // A pending status without a scan is no evidence: some carriers answer any number that way.
  const known = (result.events?.length ?? 0) > 0 || !['unknown', 'pending', undefined].includes(result.status);
  const updated = iso(result.last_update);
  return {
    known,
    lastActivityAt: !known ? null : times.length ? new Date(Math.max(...times)).toISOString()
      : Number.isFinite(updated) ? new Date(updated).toISOString() : null,
  };
}

/** Registered adapter factories plus the carrier → adapter mapping, as generated. */
export interface RegistryDefinition {
  factories: Readonly<Record<string, AdapterFactory>>;
  /** Carrier id → adapter id (a key of `factories`), 'universal', or null for link-only carriers. */
  carriers: Readonly<Record<string, string | null>>;
}

/**
 * One adapter instance per adapter id for the process lifetime, created on
 * first use so a broken provider module cannot prevent unrelated carriers
 * from syncing.
 */
export class AdapterRegistry {
  private readonly instances = new Map<string, CarrierAdapter>();

  constructor(private readonly definition: RegistryDefinition, private readonly environment: AdapterEnvironment) {}

  /** The adapter id that serves this carrier, 'universal', or null. */
  adapterIdFor(carrierId: string): string | null {
    return this.definition.carriers[carrierId] ?? null;
  }

  /** Whether a dedicated adapter module serves this carrier. */
  has(carrierId: string): boolean {
    const adapterId = this.adapterIdFor(carrierId);
    return adapterId !== null && adapterId !== 'universal' && Object.hasOwn(this.definition.factories, adapterId);
  }

  for(carrierId: string): CarrierAdapter | null {
    const adapterId = this.adapterIdFor(carrierId);
    if (adapterId === null || adapterId === 'universal') return null;
    const factory = this.definition.factories[adapterId];
    if (!factory) return null;
    let instance = this.instances.get(adapterId);
    if (!instance) {
      instance = factory(this.environment);
      this.instances.set(adapterId, instance);
    }
    return instance;
  }

  /** Every dedicated adapter id, for canaries and documentation. */
  adapterIds(): string[] {
    return Object.keys(this.definition.factories);
  }
}
