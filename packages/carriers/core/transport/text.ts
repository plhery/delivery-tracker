/** Small text helpers every adapter needs when projecting provider payloads. */

/** Collapse whitespace, trim, and cap the length of a provider string; non-strings become ''. */
export function clean(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

/** Like `clean`, for values that may arrive as numbers (ids, codes). */
export function cleanScalar(value: unknown, maxLength = 500): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : clean(value, maxLength);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip tags from an HTML fragment and collapse whitespace; for short provider strings only. */
export function textFromHtml(value: unknown, maxLength = 500): string {
  return typeof value === 'string'
    ? clean(value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"'), maxLength)
    : '';
}
