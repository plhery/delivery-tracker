import 'server-only';

import { statusMapAnswer } from 'universal-parcel-scraper/app';
import manifest from '../../package.json';
import { captureOperationalError, databaseUnavailable, errorType, logOperationalEvent } from './observability';
import type { SupabaseServiceClient } from './supabase';
import { trackingSupportContext } from './trackingSupport';
import type { JsonObject } from './types';

/** Long enough for one replay; a server that dies holding it is relieved after this. */
const REPLAY_LEASE_SECONDS = 600;
/** After startup, so a server that keeps restarting does not replay on every start. */
const REPLAY_START_DELAY_MS = 60_000;
/** While another server holds the replay, or after a failure. */
const REPLAY_RETRY_MS = 5 * 60_000;
/** The most recently seen open cases one replay reads. */
export const MAX_REPLAYED_CASES = 500;
/** The most recently seen open status observations one replay reads. */
export const MAX_REPLAYED_OBSERVATIONS = 1000;

/**
 * The tracking code this server runs: the scraper release the app pins and,
 * in an image, the app's commit. Review queue closings record it.
 */
export function deployedVersion(environment: Record<string, string | undefined> = process.env): string {
  const scraper = `universal-parcel-scraper@${manifest.dependencies['universal-parcel-scraper']}`;
  const commit = environment.IMAGE_COMMIT?.trim();
  return commit && /^[0-9a-f]{40}$/i.test(commit) ? `${scraper} app@${commit.slice(0, 12).toLowerCase()}` : scraper;
}

/**
 * Replays an open support case through this server's detection and
 * adapters: a note saying why no gap is left, or null while one is.
 */
export function replaySupportCase(trackingNumber: string, configuredCarrier: string | null): string | null {
  const context = trackingSupportContext(trackingNumber, configuredCarrier ?? 'unknown');
  if ((context.reasons as string[]).length > 0) return null;
  return `Replay found no gap: detection names ${String(context.detection_carrier)} with ${String(context.detection_confidence)} confidence.`;
}

/** Open status observations to close with one resolution and note. */
export interface StatusObservationClosing {
  resolution: 'mapped' | 'ignored';
  note: string;
  keys: string[];
}

/**
 * How the scraper this server runs closes an observed wording: as mapped when
 * its carrier's status map gives it a stage, as ignored with the map's note
 * when the map leaves it without one on purpose. Null while no map knows it.
 */
export function statusMapClosing(observation: JsonObject): Omit<StatusObservationClosing, 'keys'> | null {
  const answer = statusMapAnswer({
    carrier: String(observation.carrier ?? ''),
    providerCode: typeof observation.provider_code === 'string' ? observation.provider_code : null,
    description: String(observation.description_normalized ?? ''),
  });
  if (answer.kind === 'intentional_gap') return { resolution: 'ignored', note: answer.note.slice(0, 500) };
  if (answer.kind !== 'mapped') return null;
  // A different stage from the sightings' says their stored scans may need a repair.
  const seen = typeof observation.chosen_stage === 'string' ? observation.chosen_stage : '';
  return {
    resolution: 'mapped',
    note: seen && seen !== answer.stage
      ? `The carrier status map gives it ${answer.stage}; it was last seen as ${seen}.`
      : `The carrier status map gives it ${answer.stage}.`,
  };
}

/** The closings for these observations, one per resolution and note; `mapped` false keeps only the gaps. */
export function statusMapClosings(
  observations: readonly JsonObject[],
  options: { mapped?: boolean; version?: string } = {},
): StatusObservationClosing[] {
  const closings = new Map<string, StatusObservationClosing>();
  for (const observation of observations) {
    const key = String(observation.observation_key ?? '');
    const closing = statusMapClosing(observation);
    if (!key || !closing) continue;
    if (closing.resolution === 'mapped') {
      // Wording this version saw unmapped is covered by its map only sometimes.
      if (!options.mapped || (options.version && observation.last_seen_version === options.version)) continue;
    }
    const group = `${closing.resolution}\n${closing.note}`;
    const keys = closings.get(group)?.keys;
    if (keys) keys.push(key);
    else closings.set(group, { ...closing, keys: [key] });
  }
  return [...closings.values()];
}

export interface ReviewReplaySummary extends JsonObject {
  cases_replayed: number;
  cases_fixed: number;
  observations_replayed: number;
  observations_mapped: number;
  observations_ignored: number;
}

/**
 * Replays the review queues once for this version, across servers and
 * restarts. 'running' while another server holds the replay, 'done' once one
 * finished it. Each sync closes the wording its scraper maps or leaves
 * unmapped on purpose as it sees it (trackingSync.ts); the replay closes the
 * rest, such as the wording of finished parcels, which no sync sees again.
 */
export async function replayReviewQueues(
  client: SupabaseServiceClient,
  version: string,
): Promise<'running' | 'done' | ReviewReplaySummary> {
  const claim = await client.claimTrackingReviewRun(version, REPLAY_LEASE_SECONDS);
  if (claim !== 'claimed') return claim;
  const cases = await client.listOpenTrackingSupportCases(MAX_REPLAYED_CASES);
  const resolved = cases.flatMap((supportCase) => {
    const configuredCarrier = typeof supportCase.configured_carrier === 'string' ? supportCase.configured_carrier : null;
    const note = replaySupportCase(String(supportCase.tracking_number ?? ''), configuredCarrier);
    return note ? [{ id: String(supportCase.id), configured_carrier: configuredCarrier, note }] : [];
  });
  const fixed = resolved.length ? await client.fixReplayedTrackingSupportCases(version, resolved) : 0;
  const observations = await client.listOpenTrackingStatusObservations(MAX_REPLAYED_OBSERVATIONS);
  const closed = { mapped: 0, ignored: 0 };
  for (const closing of statusMapClosings(observations, { mapped: true, version })) {
    closed[closing.resolution] += await client.closeTrackingStatusObservations(version, closing);
  }
  const summary = {
    cases_replayed: cases.length, cases_fixed: fixed, observations_replayed: observations.length,
    observations_mapped: closed.mapped, observations_ignored: closed.ignored,
  };
  await client.finishTrackingReviewRun(version, summary);
  return summary;
}

/** Runs the replay a while after startup, then retries until a server has done it for this version. */
export class ReviewQueueReplay {
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #stopped = false;
  #done = false;
  #reported = false;

  constructor(
    readonly client: SupabaseServiceClient,
    readonly version = deployedVersion(),
  ) {}

  start(): void {
    this.#stopped = false;
    if (!this.#timer && !this.#running && !this.#done) this.schedule(REPLAY_START_DELAY_MS);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  private schedule(delayMs: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.run();
    }, delayMs);
    this.#timer.unref();
  }

  private async run(): Promise<void> {
    this.#running = true;
    try {
      const outcome = await replayReviewQueues(this.client, this.version);
      if (outcome === 'running') return;
      this.#done = true;
      if (outcome !== 'done') logOperationalEvent('review_queues_replayed', { version: this.version, ...outcome });
    } catch (error) {
      logOperationalEvent('review_queue_replay_failed', { version: this.version, error_type: errorType(error) }, 'error');
      // The sync worker reports a database that stays unreachable.
      if (!databaseUnavailable(error) && !this.#reported) {
        this.#reported = true;
        captureOperationalError(error, { component: 'review-queues', operation: 'replay' });
      }
    } finally {
      this.#running = false;
      if (!this.#stopped && !this.#done) this.schedule(REPLAY_RETRY_MS);
    }
  }
}
