/**
 * What the carrier pickers show: search over names, other names and
 * countries, the A–Z sections, the carriers someone used before, and what the
 * Add sheet's carrier check has found so far. `CarrierPicker.swift` mirrors it.
 */
import type { ApiCarrierDetectionResponse } from '../generated/apiContract';
import type { CarrierId } from '../types';
import type { CarrierInfo } from './carriers';

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Lower case without accents, one character for each character, so a match can be highlighted. */
export function foldForSearch(value: string): string {
  return Array.from(value, (character) => {
    const folded = character.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    return folded.length === 1 ? folded : character;
  }).join('');
}

function compact(value: string): string {
  return Array.from(foldForSearch(value)).filter((character) => LETTER_OR_DIGIT.test(character)).join('');
}

function startsWord(text: string, index: number): boolean {
  return index === 0 || !LETTER_OR_DIGIT.test(Array.from(text)[index - 1] ?? '');
}

/** The first match of `query` in `text` that starts a word, else -1 (code point index). */
function wordStart(text: string, query: string): number {
  const characters = Array.from(text);
  const length = Array.from(query).length;
  for (let index = 0; index + length <= characters.length; index += 1) {
    if (characters.slice(index, index + length).join('') === query && startsWord(text, index)) return index;
  }
  return -1;
}

function codePointIndex(text: string, query: string): number {
  const found = text.indexOf(query);
  return found < 0 ? -1 : Array.from(text.slice(0, found)).length;
}

export interface CarrierSearchResult {
  carrier: CarrierInfo;
  /** Code point range of the query in the name, when the name itself matched. */
  highlight?: readonly [number, number];
  /** The other name that matched, when only that name did. */
  alias?: string;
  score: number;
}

function matchCarrier(
  carrier: CarrierInfo,
  query: string,
  countryNames: (code: string) => readonly string[],
): Omit<CarrierSearchResult, 'carrier'> | null {
  const folded = foldForSearch(query.trim());
  const squeezed = compact(query);
  if (!folded) return null;
  const name = foldForSearch(carrier.name);
  const length = Array.from(folded).length;
  const lit = (start: number, score: number) => ({ highlight: [start, start + length] as const, score });
  if (name.startsWith(folded)) return lit(0, 0);
  const word = wordStart(name, folded);
  if (word > 0) return lit(word, 1);
  if (squeezed && compact(carrier.name).startsWith(squeezed)) return { score: 1.5 };
  for (const alias of carrier.aliases) {
    if (wordStart(foldForSearch(alias), folded) >= 0 || (squeezed && compact(alias).startsWith(squeezed))) {
      return { alias, score: 2 };
    }
  }
  const inside = codePointIndex(name, folded);
  if (inside > 0) return lit(inside, 3);
  if (squeezed.length > 1 && compact(carrier.name).includes(squeezed)) return { score: 3.5 };
  const alias = carrier.aliases.find((candidate) => foldForSearch(candidate).includes(folded));
  if (alias) return { alias, score: 4 };
  const country = carrier.countries.some((code) =>
    countryNames(code).some((countryName) => wordStart(foldForSearch(countryName), folded) >= 0));
  return country ? { score: 5 } : null;
}

const collators = new Map<string, Intl.Collator>();
function collator(languageTag: string): Intl.Collator {
  let value = collators.get(languageTag);
  if (!value) {
    value = new Intl.Collator(languageTag, { sensitivity: 'base', numeric: true });
    collators.set(languageTag, value);
  }
  return value;
}

/**
 * Carriers matching a query, best first: the name's start, a word in it, an
 * other name ("Colissimo", "Hugger"), anywhere in the name, then a country.
 * The carriers that fit the number rank a little higher.
 */
export function searchCarriers(
  query: string,
  carriers: readonly CarrierInfo[],
  options: {
    languageTag: string;
    /** Every name a country is searched by, such as its local and English names. */
    countryNames: (code: string) => readonly string[];
    preferred?: ReadonlySet<CarrierId>;
  },
): CarrierSearchResult[] {
  const compare = collator(options.languageTag);
  return carriers
    .flatMap((carrier) => {
      const match = matchCarrier(carrier, query, options.countryNames);
      if (!match) return [];
      return [{ carrier, ...match, score: match.score - (options.preferred?.has(carrier.id) ? 0.3 : 0) }];
    })
    .sort((left, right) => left.score - right.score || compare.compare(left.carrier.name, right.carrier.name));
}

export interface AlphabetSection {
  letter: string;
  carriers: CarrierInfo[];
}

/** Carriers by initial, in the reader's alphabet; names starting with a digit come last under "#". */
export function alphabetSections(carriers: readonly CarrierInfo[], languageTag: string): AlphabetSection[] {
  const compare = collator(languageTag);
  const sections: AlphabetSection[] = [];
  const other: AlphabetSection = { letter: '#', carriers: [] };
  for (const carrier of [...carriers].sort((left, right) => compare.compare(left.name, right.name))) {
    const letter = foldForSearch(Array.from(carrier.name)[0] ?? '').toLocaleUpperCase(languageTag);
    if (!/^\p{L}$/u.test(letter)) {
      other.carriers.push(carrier);
      continue;
    }
    const last = sections.at(-1);
    if (last?.letter === letter) last.carriers.push(carrier);
    else sections.push({ letter, carriers: [carrier] });
  }
  return other.carriers.length ? [...sections, other] : sections;
}

/**
 * The countries line under a carrier: its first two countries, with how many
 * more. Networks across many countries (Amazon) show none; the line would not
 * tell them apart.
 */
export function countryLine(countries: readonly string[], name: (code: string) => string): string {
  if (countries.length === 0 || countries.length > 5) return '';
  const names = countries.slice(0, 2).map(name).join(' · ');
  return countries.length > 2 ? `${names} +${countries.length - 2}` : names;
}

/** The carriers of someone's latest parcels, newest first, each once. */
export function usedCarrierIds(
  parcels: readonly { carrier: CarrierId; createdAt: string }[],
  selectable: (carrier: CarrierId) => boolean,
  limit = 3,
): CarrierId[] {
  const used: CarrierId[] = [];
  for (const parcel of [...parcels].sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
    if (used.length >= limit) break;
    if (selectable(parcel.carrier) && !used.includes(parcel.carrier)) used.push(parcel.carrier);
  }
  return used;
}

/**
 * The Add sheet's carrier check. It starts when the number settles (a paste,
 * leaving the field) and asks the carriers `recognitionAskedCarriers` names.
 */
export type CarrierCheck =
  /** Nothing to report: the number is not settled, or needs no check. */
  | { status: 'idle' }
  /** No carrier can be asked about this shape; routing looks it up after saving. */
  | { status: 'unasked' }
  | { status: 'asking'; asked: readonly CarrierId[] }
  | { status: 'found'; carrier: CarrierId }
  /** Unrelated carriers all know the number: the user chooses. */
  | { status: 'several'; carriers: readonly CarrierId[] }
  /** Every carrier answered and none knows it yet, which is normal for a new label. */
  | { status: 'none'; asked: readonly CarrierId[] }
  /** No carrier could answer; the first sync asks again. */
  | { status: 'failed'; asked: readonly CarrierId[] };

export function carrierCheck({ applies, settled, asked, answer }: {
  applies: boolean;
  settled: boolean;
  /** The carriers the check asks, predicted before the answer arrives. */
  asked: readonly CarrierId[];
  answer?: ApiCarrierDetectionResponse;
}): CarrierCheck {
  if (!applies || !settled) return { status: 'idle' };
  if (answer?.carrier && answer.carrier !== 'unknown') return { status: 'found', carrier: answer.carrier };
  if (answer?.recognized && answer.recognized.length > 1) return { status: 'several', carriers: answer.recognized };
  if (asked.length === 0) return { status: 'unasked' };
  if (!answer) return { status: 'asking', asked };
  const answered = answer.asked ?? [];
  if (answered.length === 0) return { status: 'unasked' };
  if ((answer.unanswered?.length ?? 0) >= answered.length) return { status: 'failed', asked: answered };
  return { status: 'none', asked: answered };
}
