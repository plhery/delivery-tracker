/**
 * Tracking-number normalization and display formatting.
 *
 * What it is: the one place that decides what "the same number" means, plus
 * the printed grouping carriers use on their labels.
 * What it is not: no carrier lookup, no checksum validation, no provider I/O.
 */

/** Uppercase and strip spaces, dots and dashes (Swiss Post prints 99.34.…). */
export function normalizeTrackingNumber(raw: string): string {
  return raw.toUpperCase().replace(/[\s.-]/g, '');
}

/** Capability-link shipment numbers look like 999.90.########. */
export function isPlanzerSharedTrackingNumber(raw: string): boolean {
  return /^99990\d{8}$/.test(normalizeTrackingNumber(raw));
}

/** Swiss carriers show 18-digit barcodes as 99.34.123456.12345678. */
export function formatTrackingNumber(raw: string): string {
  const value = normalizeTrackingNumber(raw);
  if (isPlanzerSharedTrackingNumber(value)) {
    return `${value.slice(0, 3)}.${value.slice(3, 5)}.${value.slice(5)}`;
  }
  if (/^\d{18}$/.test(value)) {
    return `${value.slice(0, 2)}.${value.slice(2, 4)}.${value.slice(4, 10)}.${value.slice(10)}`;
  }
  return value;
}

/** Shape gate applied to anything pulled out of a link or pasted prose. */
export function validTrackingNumber(raw: string): boolean {
  const normalized = normalizeTrackingNumber(raw);
  return normalized.length >= 4
    && normalized.length <= 40
    // The NACEX agency/shipment composite is the only tracking shape allowed
    // to keep punctuation; everything else stays strict alphanumeric.
    && (/^[A-Z0-9]+$/.test(normalized) || /^\d{4}\/\d{8}$/.test(normalized))
    && /\d/.test(normalized);
}
