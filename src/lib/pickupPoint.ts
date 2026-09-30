/** A carrier's pickup point: the first line names it, any further lines give its address. */
export interface PickupPoint {
  name: string;
  address: string | null;
  /** Name and address on one line, for a maps search or the clipboard. */
  query: string;
}

export function pickupPoint(text: string | null | undefined): PickupPoint | null {
  const lines = (text ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const [name, ...address] = lines;
  return { name, address: address.join(', ') || null, query: lines.join(', ') };
}

/**
 * Directions when the carrier gives an address; a search when it only names
 * the place, so the person can check which one it is. Apple devices open
 * Apple Maps, others Google Maps.
 */
export function pickupPointMapsUrl(point: PickupPoint, apple: boolean): string {
  const query = encodeURIComponent(point.query);
  if (apple) return `https://maps.apple.com/?${point.address ? 'daddr' : 'q'}=${query}`;
  return point.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function prefersAppleMaps(): boolean {
  return typeof navigator !== 'undefined' && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
}
