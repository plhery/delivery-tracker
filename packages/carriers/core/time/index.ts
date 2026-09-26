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
const COUNTRY_BY_NAME = new Map(Object.keys(COUNTRY_ZONES)
  .map((code) => [ENGLISH_REGIONS.of(code)?.toUpperCase(), code] as const));

/** The zone of a single-zone country, from an ISO code or its English name; null otherwise. */
export function countryTimeZone(country: unknown): string | null {
  if (typeof country !== 'string') return null;
  const value = country.trim().toUpperCase();
  const code = Object.hasOwn(COUNTRY_ZONES, value) ? value : COUNTRY_BY_NAME.get(value);
  return code ? COUNTRY_ZONES[code]! : null;
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
