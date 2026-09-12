/**
 * UPU S10 check digit.
 *
 * What it is: the single S10 validator used by the client, the server adapters
 * and the detection rules that declare `"checksum": "s10"`.
 * What it is not: no carrier lookup and no provider I/O. Input is normalized
 * here, so callers may pass a raw or an already-normalized number.
 */
import { normalizeTrackingNumber } from './normalize';

/** Validate the UPU S10 check digit, not only its broad A2-N9-A2 shape. */
export function isValidS10TrackingNumber(raw: string): boolean {
  const value = normalizeTrackingNumber(raw);
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value)) return false;
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = weights.reduce(
    (total, weight, index) => total + Number(value[index + 2]) * weight,
    0,
  );
  const rawCheckDigit = 11 - (sum % 11);
  const expected = rawCheckDigit === 10 ? 0 : rawCheckDigit === 11 ? 5 : rawCheckDigit;
  return Number(value[10]) === expected;
}

/** Swiss-issued tracked letter-post can move from Cainiao to Swiss Post. */
export function supportsSwissPostHandoff(raw: string): boolean {
  const value = normalizeTrackingNumber(raw);
  return /^L[A-Z]\d{9}CH$/.test(value) && isValidS10TrackingNumber(value);
}
