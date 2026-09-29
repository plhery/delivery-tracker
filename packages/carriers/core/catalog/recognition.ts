/**
 * Which carriers recognition asks about an ambiguous number.
 *
 * What it is: the ranked candidates whose adapter can cheaply say whether it
 * knows a number. The detect route and routing ask them; the Add sheets name
 * them while the answer is on its way.
 * What it is not: no provider I/O. Asking the carriers is the server's job
 * (`src/server/carrierRecognition.ts`).
 */
import { CARRIER_RECOGNITION_RANKS } from '../../generated/recognition';
import { detectCarrierMatch } from '../detection/detect';
import { AUTOMATIC_CARRIER_IDS, carrierAdapter, requiredRequirements } from './definitions';
import { carrierBrand } from './networks';
import type { CarrierInputField } from './types';

/** Carriers asked at once. */
export const MAX_RECOGNITIONS = 5;

export interface RecognitionCandidate {
  carrier: string;
  /** The first input the carrier needs before it can track, if any. */
  needsInput: CarrierInputField | null;
  /** A preferred detection rule backs it with number evidence. */
  preferred: boolean;
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

/** The carriers the detect route asks about a number, best first; empty when none can answer. */
export function recognitionAskedCarriers(number: string): string[] {
  return recognitionCandidates(number).slice(0, MAX_RECOGNITIONS).map(({ carrier }) => carrier);
}
