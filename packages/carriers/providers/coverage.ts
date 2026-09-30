/**
 * What each universal provider returned for public references of a carrier
 * ([coverage.json](coverage.json), rendered in COVERAGE.md), graded for routing.
 *
 * A carrier's references decide one tier per provider:
 * - `full`: history, with none marked partial and no reference missed that
 *   another provider knew;
 * - `partial`: history, but marked partial (label only, stops early, missing a
 *   leg, undated), or missing a reference another provider knew;
 * - `unknown`: nothing conclusive (errors, challenges, unverified, or only
 *   negatives on references too old to say anything);
 * - `empty`: answered without history (no history, summary only, a sign-in or
 *   postcode prompt);
 * - `excluded`: never history, and it answered with another carrier's parcel
 *   or refused the number format.
 *
 * Positives are strong evidence, negatives weak: one old reference can miss a
 * parcel the provider would know today. So an empty provider is asked last,
 * never skipped; only a wrong parcel or a refused format excludes it.
 */
import data from './coverage.json';
import type { UniversalSource } from './shared/result';

export type CoverageAnswer = 'history' | 'no_history' | 'summary_only' | 'sign_in' | 'postcode_prompt'
  | 'wrong_carrier' | 'refused' | 'error' | 'blocked' | 'unverified' | 'n/a';
/** History rows, an answer, or history marked partial with the reason. */
export type CoverageCell = number | CoverageAnswer | { rows: number; partial: string };
export interface CoverageReference {
  /** What this extra reference is; the first one is the table's comparison reference. */
  note?: string;
  /** Too old for a negative to say anything about current coverage. */
  stale?: boolean;
  results: Partial<Record<UniversalSource, CoverageCell>>;
}
export interface CarrierCoverage {
  carrier: string;
  /** Table name, when it differs from the catalog's display name. */
  name?: string;
  /** The table's direct-support and direct-sample cells. */
  direct: string;
  sample: string;
  references: CoverageReference[];
}
export type CoverageTier = 'full' | 'partial' | 'unknown' | 'empty' | 'excluded';

export const COVERAGE_SOURCES: readonly UniversalSource[] = ['Ship24', 'ParcelsApp', '17TRACK', 'Postal Ninja', 'UPU'];
const ANSWERS = new Set<string>(['history', 'no_history', 'summary_only', 'sign_in', 'postcode_prompt',
  'wrong_carrier', 'refused', 'error', 'blocked', 'unverified', 'n/a']);
const EMPTY = new Set<CoverageCell>(['no_history', 'summary_only', 'sign_in', 'postcode_prompt']);

export const CARRIER_COVERAGE: readonly CarrierCoverage[] = data.carriers as CarrierCoverage[];
const BY_CARRIER = new Map(CARRIER_COVERAGE.map((entry) => [entry.carrier, entry]));

export function isHistory(cell: CoverageCell | undefined): boolean {
  return typeof cell === 'number' || cell === 'history' || (typeof cell === 'object' && cell !== null);
}

/** The problems of one coverage entry, empty when it is valid. */
export function coverageProblems(entry: CarrierCoverage): string[] {
  const problems: string[] = [];
  if (!entry.references.length) problems.push('no reference');
  for (const [index, reference] of entry.references.entries()) {
    for (const [source, cell] of Object.entries(reference.results)) {
      if (!COVERAGE_SOURCES.includes(source as UniversalSource)) problems.push(`reference ${index + 1}: unknown source ${source}`);
      const valid = typeof cell === 'number' ? Number.isInteger(cell) && cell > 0
        : typeof cell === 'string' ? ANSWERS.has(cell)
          : typeof cell === 'object' && cell !== null && Number.isInteger(cell.rows) && cell.rows > 0
            && typeof cell.partial === 'string' && cell.partial.length > 0;
      if (!valid) problems.push(`reference ${index + 1}: invalid ${source} result ${JSON.stringify(cell)}`);
    }
  }
  return problems;
}

function tierOf(source: UniversalSource, references: readonly CoverageReference[]): CoverageTier {
  const seen = references.filter((reference) => reference.results[source] !== undefined);
  // A reference another provider knew, which this one did not.
  const missed = seen.some((reference) => !reference.stale
    && (EMPTY.has(reference.results[source]!) || reference.results[source] === 'wrong_carrier')
    && Object.entries(reference.results).some(([other, cell]) => other !== source && other !== 'UPU' && isHistory(cell)));
  if (seen.some((reference) => isHistory(reference.results[source]))) {
    const marked = seen.some((reference) => typeof reference.results[source] === 'object');
    return marked || missed ? 'partial' : 'full';
  }
  if (seen.some((reference) => ['wrong_carrier', 'refused'].includes(reference.results[source] as string))) return 'excluded';
  return seen.some((reference) => !reference.stale && EMPTY.has(reference.results[source]!)) ? 'empty' : 'unknown';
}

/** Each provider's tier for a carrier, or null when the carrier has no coverage evidence. */
export function coverageTiers(carrier: string | null | undefined): Record<UniversalSource, CoverageTier> | null {
  const entry = carrier ? BY_CARRIER.get(carrier) : undefined;
  if (!entry) return null;
  return Object.fromEntries(COVERAGE_SOURCES.map((source) => [source, tierOf(source, entry.references)])) as Record<UniversalSource, CoverageTier>;
}
