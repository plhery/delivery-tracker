import 'server-only';

import type { Recognition } from '@carriers/core/adapter';
import { carrierBrand } from '@carriers/core/catalog/hints';
import type { CarrierInputField } from '@carriers/core/catalog/types';
import { detectCarrierMatch } from '@carriers/core/detection';
import { CARRIER_RECOGNITION_RANKS } from '@carriers/generated/recognition';
import { AUTOMATIC_CARRIER_IDS, carrierAdapter, requiredRequirements } from './carriers';

/**
 * Carrier recognition: when a number's shape fits several carriers, ask the
 * ones that can answer cheaply whether they know it. The Add sheet runs it
 * while the user is still in the form, the first sync runs it again after
 * saving, and routing keeps retrying it while the filed carrier cannot track
 * the number.
 */

/** Carriers asked at once. */
export const MAX_RECOGNITIONS = 5;
/** An answer for a parcel quiet this long is taken for an older parcel that reused the number. */
const RECENT_ACTIVITY_MS = 60 * 24 * 3_600_000;

export interface RecognitionCandidate {
  carrier: string;
  /** The first input the carrier needs before it can track, if any. */
  needsInput: CarrierInputField | null;
  /** A preferred detection rule backs it with number evidence. */
  preferred: boolean;
}

export type RecognitionStatus = 'known' | 'unknown' | 'failed';

export interface RecognitionOutcome extends RecognitionCandidate {
  status: RecognitionStatus;
  lastActivityAt: string | null;
}

/**
 * The low-confidence candidates worth asking, best first: the carrier a
 * universal provider named, then the ones number evidence backs, then the
 * catalog's popularity rank. Only carriers that declare `tracking.recognition`
 * qualify. A high-confidence number needs no recognition.
 */
export function recognitionCandidates(
  number: string,
  options: { hint?: string; skip?: (carrier: string) => boolean } = {},
): RecognitionCandidate[] {
  const detected = detectCarrierMatch(number);
  if (detected.confidence !== 'low') return [];
  // A carrier the number points to but that cannot be asked (DPD France) keeps
  // its brand's other networks out: DPD's guest API also answers for DPD
  // France parcels, and would file one under DPD Switzerland.
  const shadowed = new Set(detected.preferred
    .filter((carrier) => CARRIER_RECOGNITION_RANKS[carrier] === undefined)
    .map((carrier) => carrierBrand(carrier)).filter(Boolean));
  const score = (carrier: string) => [
    carrier === options.hint ? 1 : 0,
    detected.preferred.includes(carrier as never) ? 1 : 0,
    CARRIER_RECOGNITION_RANKS[carrier] ?? 0,
  ];
  return detected.candidates
    .filter((carrier) => CARRIER_RECOGNITION_RANKS[carrier] !== undefined && AUTOMATIC_CARRIER_IDS.has(carrier)
      && carrierAdapter(carrier) !== 'universal' && !shadowed.has(carrierBrand(carrier)) && !options.skip?.(carrier))
    .map((carrier) => ({ carrier, score: score(carrier) }))
    // Array#sort is stable: equal scores keep the catalog order.
    .sort((left, right) => right.score[0] - left.score[0] || right.score[1] - left.score[1] || right.score[2] - left.score[2])
    .map(({ carrier }) => ({
      carrier,
      needsInput: requiredRequirements(carrier, number)[0]?.field ?? null,
      preferred: detected.preferred.includes(carrier as never),
    }));
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
