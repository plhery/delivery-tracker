/**
 * The contract between the host and a carrier adapter.
 *
 * A carrier folder exports an `AdapterFactory`; the generated registry lists
 * every factory by carrier id, and the host creates one adapter instance per
 * process through an `AdapterRegistry`. An adapter owns its sessions and
 * declares its steps; it reaches the network only through what the
 * `AdapterEnvironment` provides, and it reports through the `StepRecorder`.
 */
import type { CarrierResult } from '../result';
import type { StepRecorder } from '../telemetry';
import type { TrawlClient } from '../transport/trawl';

export interface TrackingInput {
  /** The tracking number as stored on the parcel, validated at the API boundary. */
  number: string;
  /** A capability URL for carriers that need one (shared Planzer links, Dachser). */
  trackingUrl?: string | null;
  /** The delivery postcode for carriers that need one; part of the tracking credential. */
  postcode?: string | null;
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

export interface CarrierAdapter {
  readonly id: string;
  /** The tiers this adapter can go through, in order; telemetry labels use these ids. */
  readonly steps: readonly string[];
  track(input: TrackingInput, context?: TrackingContext): Promise<CarrierResult>;
}

export type AdapterFactory = (environment: AdapterEnvironment) => CarrierAdapter;

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
