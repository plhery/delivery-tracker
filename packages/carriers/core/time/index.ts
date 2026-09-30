/**
 * Timestamp parsing with an explicit timezone policy.
 *
 * Providers disagree about time: some send offsets, some send naive wall-clock
 * strings in a known zone, some send epoch milliseconds, some only a calendar
 * day. Each helper below implements one policy and documents its limits so an
 * adapter states which one applies instead of re-implementing the parsing.
 * Every helper returns `null` rather than guessing.
 */
import { DateTime } from 'luxon';
import { REGION_TOWNS } from '../../generated/regionTowns';
import { clean } from '../transport/text';

export interface ParsedTime {
  /** ISO 8601 with the source offset preserved and no milliseconds. */
  iso: string;
  /** Epoch milliseconds, for ordering. */
  timestamp: number;
}

export const EXPLICIT_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function fromDateTime(parsed: DateTime): ParsedTime | null {
  const iso = parsed.isValid ? parsed.toISO({ suppressMilliseconds: true }) : null;
  return iso ? { iso, timestamp: parsed.toMillis() } : null;
}

/**
 * ISO strings that carry their own offset. Use for cross-border lanes where
 * stamping a zone would be wrong; offset-less values are rejected.
 */
export function explicitOffsetTime(value: unknown, maxLength = 64): ParsedTime | null {
  const raw = clean(value, maxLength);
  if (!raw || !EXPLICIT_OFFSET_PATTERN.test(raw)) return null;
  return fromDateTime(DateTime.fromISO(raw, { setZone: true }));
}

/**
 * Naive wall-clock strings in one known zone. Use when the provider documents
 * (or live checks show) a single backend zone; note regional caveats in the
 * adapter.
 */
export function zonedTime(
  value: unknown,
  format: string,
  zone: string,
  options: { locale?: string; maxLength?: number } = {},
): ParsedTime | null {
  const raw = clean(value, options.maxLength ?? 64);
  if (!raw) return null;
  return fromDateTime(DateTime.fromFormat(raw, format, { zone, locale: options.locale }));
}

/** ISO strings that may or may not carry an offset; offset-less values are read in `zone`. */
export function isoTime(value: unknown, zone: string, maxLength = 64): ParsedTime | null {
  const raw = clean(value, maxLength);
  if (!raw) return null;
  const parsed = EXPLICIT_OFFSET_PATTERN.test(raw)
    ? DateTime.fromISO(raw, { setZone: true })
    : DateTime.fromISO(raw, { zone });
  return fromDateTime(parsed);
}

/** The digits of a labeled instant read in UTC, or of an offset-less value as given. */
function labeledDigits(value: unknown, maxLength: number): DateTime | null {
  const raw = clean(value, maxLength);
  if (!raw) return null;
  const labeled = EXPLICIT_OFFSET_PATTERN.test(raw)
    ? DateTime.fromISO(raw, { setZone: true }).toUTC()
    : DateTime.fromISO(raw, { zone: 'utc' });
  return labeled.isValid ? labeled : null;
}

/**
 * Wall-clock times a provider labels as UTC (or with an offset of its own)
 * although they are the scan's local time: ParcelsApp and PostNL do this. The
 * digits of the labeled instant, read in UTC, are re-read in `zone`.
 * Offset-less values are read in `zone` directly.
 */
export function mislabeledLocalTime(value: unknown, zone: string, maxLength = 64): ParsedTime | null {
  const labeled = labeledDigits(value, maxLength);
  if (!labeled) return null;
  const { year, month, day, hour, minute, second, millisecond } = labeled;
  return fromDateTime(DateTime.fromObject({ year, month, day, hour, minute, second, millisecond }, { zone }));
}

/** The wall clock `mislabeledLocalTime` re-reads, as an offset-less ISO string. */
export function mislabeledWallTime(value: unknown, maxLength = 64): string | null {
  return labeledDigits(value, maxLength)?.toISO({ includeOffset: false }) ?? null;
}

/**
 * One zone for several that keep the same clock at `wallIso`, an offset-less
 * wall time: the first zone when every zone reads it as the same instant.
 * Null when none is given, a zone or the time is invalid, the time carries an
 * offset (every zone would agree), or the zones disagree at that moment, as
 * Zurich and London always do.
 */
export function sharedClockZone(zones: readonly string[], wallIso: string): string | null {
  if (!zones.length || EXPLICIT_OFFSET_PATTERN.test(wallIso)) return null;
  const instants = zones.map((zone) => DateTime.fromISO(wallIso, { zone }));
  const first = instants[0]!.toMillis();
  return instants.every((instant) => instant.isValid && instant.toMillis() === first) ? zones[0]! : null;
}

/** A scan's instant when the feed states it, else the readings its clock may have, likeliest first. */
export interface FeedClock {
  known?: ParsedTime | null;
  guesses?: readonly (ParsedTime | null)[];
}

// Some scanners run early; the host flags a scan only past the same hour.
const CLOCK_SKEW_MS = 3_600_000;

/**
 * Settles guessed clocks against the feed itself, given newest first. A guess
 * stands only if it is not after the lookup (`readAt`, give or take an hour of
 * skew) and keeps the feed's order: not after the nearest newer scan with a
 * known instant, not before the nearest older one. Each scan gets its known
 * instant or its first guess that stands; null when none does.
 */
export function settleGuessedClocks(scans: readonly FeedClock[], readAt: number): (ParsedTime | null)[] {
  const known = scans.map((scan) => scan.known ?? null);
  const nearest = (from: number, step: number): number | undefined => {
    for (let index = from; index >= 0 && index < known.length; index += step) {
      if (known[index]) return known[index]!.timestamp;
    }
    return undefined;
  };
  return scans.map((scan, index) => {
    if (scan.known) return scan.known;
    const newer = nearest(index - 1, -1);
    const older = nearest(index + 1, 1);
    return scan.guesses?.find((guess): guess is ParsedTime => Boolean(guess)
      && guess!.timestamp <= readAt + CLOCK_SKEW_MS
      && (newer === undefined || guess!.timestamp <= newer)
      && (older === undefined || guess!.timestamp >= older)) ?? null;
  });
}

// Countries that keep one civil time. Spain and Portugal use their mainland
// zone (their islands differ by an hour). Countries spanning several zones
// (US, CA, BR, RU, AU, MX, ID...) are absent: they need a finer location.
const COUNTRY_ZONES: Record<string, string> = {
  AT: 'Europe/Vienna', BE: 'Europe/Brussels', BG: 'Europe/Sofia', CH: 'Europe/Zurich',
  CY: 'Asia/Nicosia', CZ: 'Europe/Prague', DE: 'Europe/Berlin', DK: 'Europe/Copenhagen',
  EE: 'Europe/Tallinn', ES: 'Europe/Madrid', FI: 'Europe/Helsinki', FR: 'Europe/Paris',
  GB: 'Europe/London', GR: 'Europe/Athens', HR: 'Europe/Zagreb', HU: 'Europe/Budapest',
  IE: 'Europe/Dublin', IS: 'Atlantic/Reykjavik', IT: 'Europe/Rome', LI: 'Europe/Vaduz',
  LT: 'Europe/Vilnius', LU: 'Europe/Luxembourg', LV: 'Europe/Riga', MT: 'Europe/Malta',
  NL: 'Europe/Amsterdam', NO: 'Europe/Oslo', PL: 'Europe/Warsaw', PT: 'Europe/Lisbon',
  RO: 'Europe/Bucharest', SE: 'Europe/Stockholm', SI: 'Europe/Ljubljana', SK: 'Europe/Bratislava',
  TR: 'Europe/Istanbul', AE: 'Asia/Dubai', IL: 'Asia/Jerusalem', IN: 'Asia/Kolkata',
  CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
  MY: 'Asia/Kuala_Lumpur', PH: 'Asia/Manila', SG: 'Asia/Singapore', TH: 'Asia/Bangkok',
  TW: 'Asia/Taipei', VN: 'Asia/Ho_Chi_Minh',
};
const ENGLISH_REGIONS = new Intl.DisplayNames(['en'], { type: 'region' });
// Every region Intl names, by English name. Retired codes ("FX", "UK") repeat
// a current region's name and are left out.
const REGION_BY_NAME = new Map(Array.from({ length: 26 * 26 }, (_, index) =>
  String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)))
  .filter((code) => ENGLISH_REGIONS.of(code) !== code && new Intl.Locale(`und-${code}`).region === code)
  .map((code) => [ENGLISH_REGIONS.of(code)!.toUpperCase(), code] as const));
const REGION_CODES = new Set(REGION_BY_NAME.values());

/**
 * The ISO code of any country, whatever its clocks, from the code or its
 * English name ("South Africa" is ZA, "United States" US); null otherwise.
 */
export function countryCode(country: unknown): string | null {
  if (typeof country !== 'string') return null;
  const value = country.trim().toUpperCase();
  return REGION_CODES.has(value) ? value : REGION_BY_NAME.get(value) ?? null;
}

/** The zone of a single-zone country, from an ISO code or its English name; null otherwise. */
export function countryTimeZone(country: unknown): string | null {
  const code = countryCode(country);
  return code && Object.hasOwn(COUNTRY_ZONES, code) ? COUNTRY_ZONES[code]! : null;
}

/** The single-zone country keeping this civil time ("Europe/Zurich" is Switzerland's); null for UTC. */
export function timeZoneCountry(zone: string): string | null {
  const countries = Object.keys(COUNTRY_ZONES).filter((code) => COUNTRY_ZONES[code] === zone);
  return countries.length === 1 ? countries[0]! : null;
}

// US states and territories by postal code. A state with several zones keeps its
// majority zone.
const US_STATE_ZONES: Readonly<Record<string, string>> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/New_York', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
  GU: 'Pacific/Guam', VI: 'America/St_Thomas', AS: 'Pacific/Pago_Pago', MP: 'Pacific/Saipan',
};

/**
 * The zone of a US state or territory from its postal code ("IL"): its
 * majority zone when it has several; null otherwise.
 */
export function usStateTimeZone(state: unknown): string | null {
  if (typeof state !== 'string') return null;
  const code = state.trim().toUpperCase();
  return Object.hasOwn(US_STATE_ZONES, code) ? US_STATE_ZONES[code]! : null;
}

// Canadian provinces and territories by postal code, each in its majority zone.
const CANADA_PROVINCE_ZONES: Readonly<Record<string, string>> = {
  AB: 'America/Edmonton', BC: 'America/Vancouver', MB: 'America/Winnipeg', NB: 'America/Moncton',
  NL: 'America/St_Johns', NS: 'America/Halifax', NT: 'America/Edmonton', NU: 'America/Iqaluit',
  ON: 'America/Toronto', PE: 'America/Halifax', QC: 'America/Toronto', SK: 'America/Regina',
  YT: 'America/Whitehorse',
};

/** The zone of a Canadian province or territory from its postal code ("ON"): its majority zone; null otherwise. */
export function canadaProvinceTimeZone(province: unknown): string | null {
  if (typeof province !== 'string') return null;
  const code = province.trim().toUpperCase();
  return Object.hasOwn(CANADA_PROVINCE_ZONES, code) ? CANADA_PROVINCE_ZONES[code]! : null;
}

/** A town name as the region town lists key it: "St. John's" and "SAINT JOHNS" are both "stjohns". */
export function townKey(name: string): string {
  return name.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
    .replace(/\bsaint\b/g, 'st').replace(/\bsainte\b/g, 'ste').replace(/\bmount\b/g, 'mt').replace(/\bfort\b/g, 'ft')
    .replace(/[^a-z0-9]/g, '');
}

const REGION_TOWN_SETS = new Map(Object.entries(REGION_TOWNS).map(([code, towns]) => [code, new Set(towns.split('|'))]));

/**
 * Whether a town of this name lies in the US state or Canadian province whose
 * code also names a single-clock country: Chicago is in Illinois, not Israel,
 * and Koeln is not in Delaware. Only DE, IL, IN, MT, NL and SK have town lists
 * (generated from GeoNames); false for any other code.
 */
export function regionHasTown(code: string, town: string): boolean {
  return REGION_TOWN_SETS.get(code.trim().toUpperCase())?.has(townKey(town)) ?? false;
}

/** Epoch milliseconds (numbers or numeric strings); zero and negatives are rejected. */
export function epochMillisTime(value: unknown): ParsedTime | null {
  const millis = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return fromDateTime(DateTime.fromMillis(millis, { zone: 'utc' }));
}

/** Epoch seconds, same rules as `epochMillisTime`. */
export function epochSecondsTime(value: unknown): ParsedTime | null {
  const seconds = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return epochMillisTime(seconds * 1000);
}

/** A local calendar day as `YYYY-MM-DD`, validated; never a timestamp. */
export function calendarDay(year: number, month: number, day: number): string | null {
  if (![year, month, day].every(Number.isInteger)) return null;
  const parsed = DateTime.fromObject({ year, month, day }, { zone: 'utc' });
  return parsed.isValid ? parsed.toISODate() : null;
}
