import 'server-only';

import type { Recognition } from '@carriers/core/adapter';
import { carrierBrand } from '@carriers/core/catalog/networks';
import type { RecognitionCandidate } from '@carriers/core/catalog/recognition';
import { CARRIER_RECOGNITION_RANKS } from '@carriers/generated/recognition';

export {
  MAX_RECOGNITIONS,
  recognitionCandidates,
  type RecognitionCandidate,
} from '@carriers/core/catalog/recognition';

/**
 * Carrier recognition: when a number's shape fits several carriers, ask the
 * ones that can answer cheaply whether they know it. The Add sheet runs it
 * while the user is still in the form, the first sync runs it again after
 * saving, and routing keeps retrying it while the filed carrier cannot track
 * the number. Which carriers qualify is shared with the Add sheets
 * (`@carriers/core/catalog/recognition`), which name them while they answer.
 */

/** An answer for a parcel quiet this long is taken for an older parcel that reused the number. */
const RECENT_ACTIVITY_MS = 60 * 24 * 3_600_000;

export type RecognitionStatus = 'known' | 'unknown' | 'failed';

export interface RecognitionOutcome extends RecognitionCandidate {
  status: RecognitionStatus;
  lastActivityAt: string | null;
}

/**
 * Ask every candidate at once. A candidate that throws, or has not answered
 * when the budget runs out, is `failed`; its lookup may still finish in the
 * background, but its answer is ignored.
 */
export async function recognizeAll(
  candidates: readonly RecognitionCandidate[],
  recognize: (carrier: string) => Promise<Recognition>,
  budgetMs: number,
): Promise<RecognitionOutcome[]> {
  const outcomes: RecognitionOutcome[] = candidates.map((candidate) => ({ ...candidate, status: 'failed', lastActivityAt: null }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); });
  const asked = candidates.map(async (candidate, index) => {
    try {
      const answer = await recognize(candidate.carrier);
      outcomes[index] = { ...candidate, status: answer.known ? 'known' : 'unknown', lastActivityAt: answer.lastActivityAt ?? null };
    } catch {
      // Stays failed: an outage is no answer about the number.
    }
  });
  try {
    await Promise.race([Promise.all(asked), deadline]);
  } finally {
    clearTimeout(timer);
  }
  return outcomes.map((outcome) => ({ ...outcome }));
}

function recent(outcome: RecognitionOutcome, now: Date): boolean {
  const at = Date.parse(outcome.lastActivityAt ?? '');
  return !Number.isFinite(at) || now.getTime() - at < RECENT_ACTIVITY_MS;
}

/**
 * The carrier the answers settle on: the only recent one, else the only one
 * number evidence backs, else, when every answer comes from one brand's
 * networks, the most popular of them. Unrelated carriers that all know the
 * number stay a choice for the user.
 */
export function settleRecognition(outcomes: readonly RecognitionOutcome[], now = new Date()): { carrier?: string; choices: string[] } {
  const known = outcomes.filter((outcome) => outcome.status === 'known' && recent(outcome, now));
  if (known.length === 0) return { choices: [] };
  if (known.length === 1) return { carrier: known[0].carrier, choices: [] };
  const backed = known.filter((outcome) => outcome.preferred);
  if (backed.length === 1) return { carrier: backed[0].carrier, choices: [] };
  const brands = new Set(known.map((outcome) => carrierBrand(outcome.carrier) ?? outcome.carrier));
  if (brands.size === 1) {
    const [best] = [...known].sort((left, right) =>
      (CARRIER_RECOGNITION_RANKS[right.carrier] ?? 0) - (CARRIER_RECOGNITION_RANKS[left.carrier] ?? 0));
    return { carrier: best.carrier, choices: [] };
  }
  return { choices: known.map((outcome) => outcome.carrier) };
}
