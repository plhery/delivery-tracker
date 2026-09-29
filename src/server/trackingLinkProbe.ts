/** A public tracking page check is distinct from a successful parcel lookup. */
export interface TrackingPageSnapshot {
  status: number;
  url: string;
  title: string;
  text: string;
}

export type TrackingPageVerdict = 'tracking-page' | 'blocked' | 'broken' | 'unverified';

export function trackingPageVerdict(
  page: TrackingPageSnapshot,
  route: RegExp,
  trackingContent: RegExp,
  shipmentNotFound?: { status: 404 | 410; marker: RegExp },
): TrackingPageVerdict {
  // A generic homepage, error route or missing page must never pass merely
  // because the carrier returned 200. Shipment-not-found is a valid tracker.
  const knownAbsence = shipmentNotFound?.status === page.status && route.test(page.url)
    && shipmentNotFound.marker.test(page.text);
  if (((page.status === 404 || page.status === 410) && !knownAbsence) || page.status >= 500) return 'broken';
  const content = page.title + '\n' + page.text;
  if ([401, 403, 429].includes(page.status)
    || /just a moment|un instant|access denied|attention required|verify you are human|vérification de sécurité|complete the captcha|captcha required|checking your browser/i.test(content)) return 'blocked';
  if ((!knownAbsence && (page.status < 200 || page.status >= 300)) || !route.test(page.url)) return 'broken';
  if (/page (?:not found|does not exist|cannot be found)|404 (?:error|not found)|seite nicht gefunden|page introuvable|pagina non trovata/i.test(content)) return 'broken';
  return trackingContent.test(page.text) ? 'tracking-page' : 'unverified';
}
