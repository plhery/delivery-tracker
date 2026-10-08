import 'server-only';

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

export interface ReviewReplaySummary extends JsonObject {
  cases_replayed: number;
  cases_fixed: number;
}

/**
 * Replays the open support cases once for this version, across servers and
 * restarts. 'running' while another server holds the replay, 'done' once one
 * finished it. Status observations need no replay: each sync closes the
 * wording its scraper maps (trackingSync.ts).
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
  const summary = { cases_replayed: cases.length, cases_fixed: fixed };
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
