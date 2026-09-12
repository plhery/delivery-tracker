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
