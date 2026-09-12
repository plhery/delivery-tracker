/**
 * C Chez Vous: the public order-tracking page at cchezvous.fr/suivi-colis.
 *
 * One bounded GET per lookup ('direct' step). The page embeds its whole order
 * record as JSON in a `<tracking :tracking-results="…">` attribute: the shop,
 * the recipient's name, address, phone and e-mail, the ordered articles and the
 * booked time window sit next to the per-parcel step. `parse()` reads the step
 * and the delivery date and nothing else.
 *
 * The order reference alone opens that page, so it is part of the tracking
 * credential: never log it, quote it in an issue, or put a real one in a
 * fixture.
 */
import 'server-only';

import { load } from 'cheerio';
import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import { UpstreamHttpError, clean, decodeText, fetchBounded } from '../../core/transport';
import { isRecord } from '../../core/types';
import { UNKNOWN_STEP, UNKNOWN_STEP_DESCRIPTION, parcelStep, stepDetails } from './status';

export { STEP_DETAILS, stepDetails } from './status';

const PROVIDER = 'C Chez Vous';
const TRACKING_BASE = 'https://www.cchezvous.fr/suivi-colis';
const TIMEZONE = 'Europe/Paris';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;

const FRENCH_POSTCODE = /^(?:0[1-9]|[1-8]\d|9[0-5]|97|98)\d{3}$/;
const NOT_FOUND_PATTERN = /commande est introuvable|commande introuvable/i;

/**
 * The embedded record carries ISO timestamps for the delivery appointment. Only
 * the calendar day is kept, so no `core/time` policy applies: the day is read
 * off the string, and a string `Date.parse` refuses is dropped.
 */
function normalizedIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(candidate);
  if (!match || Number.isNaN(Date.parse(candidate))) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeResponseCredential(value: unknown): string {
  if (typeof value !== 'string') {
    throw new SchemaError(PROVIDER, 'C Chez Vous returned an invalid shipment number');
  }
  try {
    return normalizeCChezVousCredential(value);
  } catch (error) {
    throw new SchemaError(PROVIDER, 'C Chez Vous returned an invalid shipment number', { cause: error });
  }
}

export function normalizeCChezVousCredential(raw: string): string {
  const value = raw.trim().toLocaleUpperCase('en-US').replace(/\s/g, '');
  const composite = /^([A-Z0-9]{11})--(\d{5})$/.exec(value);
  if (composite) {
    if (!FRENCH_POSTCODE.test(composite[2])) {
      throw new TypeError('C Chez Vous tracking contains an invalid French postcode');
    }
    return `${composite[1]}--${composite[2]}`;
  }

  // Shared package normalization removes punctuation. The only documented compact
  // composite form has an 11-character order followed by its 5-digit postcode.
  const compactComposite = /^([A-Z0-9]{11})(\d{5})$/.exec(value);
  if (compactComposite) {
    if (!FRENCH_POSTCODE.test(compactComposite[2])) {
      throw new TypeError('C Chez Vous tracking contains an invalid French postcode');
    }
    return `${compactComposite[1]}--${compactComposite[2]}`;
  }

  if (!/^(?=.*\d)[A-Z0-9]{8,15}$/.test(value)) {
    throw new TypeError(
      'C Chez Vous tracking requires an 8- to 15-character order number, or an 11-character order followed by -- and a French postcode',
    );
  }
  return value;
}

export function cChezVousTrackingUrl(rawCredential: string): string {
  const credential = normalizeCChezVousCredential(rawCredential);
  return `${TRACKING_BASE}/${encodeURIComponent(credential)}`;
}

export function parseCChezVousTrackingHtml(
  html: string,
  rawCredential: string,
): CarrierResult {
  const credential = normalizeCChezVousCredential(rawCredential);
  if (!html.trim()) throw new SchemaError(PROVIDER, 'C Chez Vous returned an empty tracking response');
  if (NOT_FOUND_PATTERN.test(html)) throw new NotFoundError(PROVIDER);

  const $ = load(html);
  const tracking = $('tracking').first();
  const encodedResult = tracking.attr(':tracking-results')
    ?? tracking.attr('v-bind:tracking-results');
  if (!encodedResult) throw new SchemaError(PROVIDER, 'C Chez Vous did not return tracking details');

  let payload: unknown;
  try {
    payload = JSON.parse(encodedResult);
  } catch (error) {
    throw new SchemaError(PROVIDER, 'C Chez Vous returned an invalid tracking response', { cause: error });
  }
  if (!isRecord(payload)) {
    throw new SchemaError(PROVIDER, 'C Chez Vous returned an invalid tracking response');
  }

  const responseCredential = normalizeResponseCredential(payload.package_number);
  if (responseCredential !== credential) {
    throw new SchemaError(PROVIDER, 'C Chez Vous returned a different shipment');
  }
  const displayedCredential = clean($('.title--tertiary').first().text(), 64);
  if (displayedCredential
    && normalizeResponseCredential(displayedCredential) !== credential) {
    throw new SchemaError(PROVIDER, 'C Chez Vous returned a different shipment');
  }

  const parcels = Array.isArray(payload.parcels) ? payload.parcels.filter(isRecord) : [];
  if (parcels.length === 0) {
    throw new SchemaError(PROVIDER, 'C Chez Vous returned incomplete tracking details');
  }
  const steps = parcels.map((parcel) => parcelStep(parcel.parcelStep));
  // A multi-parcel order is complete only when its least-advanced parcel is complete,
  // and a parcel on a step we do not know makes the whole order unknown.
  const currentStep = steps.includes(UNKNOWN_STEP) ? UNKNOWN_STEP : Math.min(...steps);
  const current = stepDetails(currentStep);
  const deliveryDates = parcels
    .map((parcel) => normalizedIsoDate(parcel.date))
    .filter((date): date is string => date !== null)
    .sort();
  const expectedDelivery = deliveryDates.at(-1) ?? null;

  return {
    status: current?.status ?? 'unknown',
    ...(current ? { current_stage: current.stage } : {}),
    last_status_text: current?.description ?? UNKNOWN_STEP_DESCRIPTION,
    last_update: null,
    expected_delivery: current?.status === 'delivered' ? null : expectedDelivery,
    timezone: TIMEZONE,
    events: [{
      description: current?.description ?? UNKNOWN_STEP_DESCRIPTION,
      // An unknown step carries no stage: the sync classifies and records it.
      ...(current ? { stage: current.stage } : {}),
    }],
  };
}

export interface CChezVousTrackerOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

export class CChezVousTracker {
  readonly timeoutMs: number;
  readonly #fetcher: typeof fetch | undefined;

  constructor(options: CChezVousTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('C Chez Vous timeout must be positive');
    }
    this.#fetcher = options.fetcher;
  }

  async fetch(rawCredential: string): Promise<CarrierResult> {
    const credential = normalizeCChezVousCredential(rawCredential);
    const { response, bytes } = await fetchBounded(cChezVousTrackingUrl(credential), {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
    }, {
      provider: 'C Chez Vous tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      redirect: 'manual',
      allowHttpError: true,
      fetcher: this.#fetcher,
    });

    // An unknown order is redirected back to the tracking form instead of a 404.
    if (response.status === 404 || (response.status >= 300 && response.status < 400)) {
      throw new NotFoundError(PROVIDER);
    }
    if (!response.ok) throw new UpstreamHttpError('C Chez Vous tracking', response.status);
    return parseCChezVousTrackingHtml(decodeText(bytes), credential);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new CChezVousTracker({ fetcher: environment.fetcher });
  return {
    id: 'c-chez-vous',
    steps: ['direct'],
    // The postcode, when the order needs one, is already part of the stored number.
    track: (input) => tracker.fetch(input.number),
  };
};
