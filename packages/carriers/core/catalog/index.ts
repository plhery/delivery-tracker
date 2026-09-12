/**
 * The carrier catalog, as the application consumes it.
 *
 * What it is: the `CARRIERS` record derived from the generated catalog, the
 * per-carrier lookups, and the tracking links that follow from catalog data
 * alone (carrier portals, localized URLs, a parcel's link list).
 * What it is not: no provider I/O, no HTTP, no application or framework code.
 * Everything here is a pure function of the catalog and its arguments.
 */
import type { CarrierId } from '../../generated/catalog';
import { isValidMondialRelayBarcode } from '../detection/mondialRelay';
import { normalizeTrackingNumber } from '../detection/normalize';
import { supportsSwissPostHandoff } from '../detection/s10';
import { amazonOrdersUrl, amazonShippingUrl, requiresAmazonAccount } from './amazon';
import { CARRIER_DEFINITIONS } from './definitions';
import type {
  CarrierDefinition,
  CarrierInfo,
  CarrierInputRequirement,
  ParcelTrackingLink,
  TrackedParcel,
} from './types';

export * from './types';
export * from './definitions';
export * from './linkRules';
export * from './amazon';

/** Carriers that print a composite or padded number link to a shorter form. */
export function trackingNumberForLink(carrierId: CarrierId, raw: string): string {
  const normalized = normalizeTrackingNumber(raw);
  if (carrierId === 'mondial-relay' && isValidMondialRelayBarcode(normalized)) return normalized.slice(0, 12);
  if (carrierId === 'c-chez-vous') {
    const composite = /^([A-Z0-9]{11})(\d{5})$/.exec(normalized);
    if (composite) return `${composite[1]}--${composite[2]}`;
  }
  return raw;
}

/** Build a carrier's portal link factory from its catalog template. */
export function trackingLink(carrierId: CarrierId, template: string | undefined) {
  if (carrierId === 'amazon-logistics') return amazonOrdersUrl;
  if (carrierId === 'amazon-shipping') return amazonShippingUrl;
  if (!template) return undefined;
  return (trackingNumber: string) =>
    template.replace(
      '{trackingNumber}',
      encodeURIComponent(trackingNumberForLink(carrierId, trackingNumber)),
    );
}

function builtCarrierInfo(id: CarrierId, carrier: CarrierDefinition): CarrierInfo {
  return {
    id,
    name: carrier.displayName,
    trackingSiteName: carrier.trackingSiteName,
    color: carrier.color,
    trackingUrl: trackingLink(id, carrier.trackingUrlTemplate),
    capabilities: {
      tracking: {
        mode: carrier.tracking.mode,
        adapter: carrier.tracking.adapter,
        requirements: [...(carrier.tracking.requirements ?? [])],
      },
      selectable: carrier.selectable,
      timezone: carrier.timezone,
    },
  };
}

export const CARRIERS = Object.fromEntries(
  Object.entries(CARRIER_DEFINITIONS).map(([id, carrier]) => [
    id,
    builtCarrierInfo(id as CarrierId, carrier),
  ]),
) as Record<CarrierId, CarrierInfo>;

export function carrierInfo(id: CarrierId, locale?: string): CarrierInfo {
  const carrier = CARRIERS[id] ?? CARRIERS.unknown;
  const name = locale ? CARRIER_DEFINITIONS[carrier.id].displayNames?.[locale] : undefined;
  return name ? { ...carrier, name } : carrier;
}

export const SELECTABLE_CARRIERS = Object.values(CARRIERS).filter(
  (carrier) => carrier.capabilities.selectable,
);

/** The requirements a form shows for one number, matched unanchored. */
export function carrierRequirements(
  carrierId: CarrierId,
  trackingNumber: string,
): CarrierInputRequirement[] {
  const normalized = normalizeTrackingNumber(trackingNumber);
  return CARRIERS[carrierId].capabilities.tracking.requirements.filter(
    (requirement) =>
      !requirement.whenTrackingNumber
      || new RegExp(requirement.whenTrackingNumber).test(normalized),
  );
}

export function tracksAutomatically(carrierId: CarrierId): boolean {
  return CARRIERS[carrierId].capabilities.tracking.mode === 'automatic';
}

export function carrierTrackingHintKey(carrierId: CarrierId) {
  return requiresAmazonAccount(carrierId) ? 'add.amazonAccount'
    : tracksAutomatically(carrierId) ? 'add.autoSync' : 'add.linkSync';
}

/** The source shown on cards and used as the primary link. */
export function activeTrackingCarrierId(
  parcel: Pick<TrackedParcel, 'carrier' | 'trackingNumber' | 'trackingSource'>,
): CarrierId {
  if (requiresAmazonAccount(parcel.carrier, parcel.trackingNumber)) return 'amazon-logistics';
  if (parcel.trackingSource) return parcel.trackingSource;
  return supportsSwissPostHandoff(parcel.trackingNumber) ? 'aliexpress' : parcel.carrier;
}

/** Keep the original carrier identity when separate tracking numbers have been linked. */
export function displayedCarrierId(
  parcel: Pick<TrackedParcel, 'carrier' | 'trackingNumber' | 'trackingSource' | 'originalCarrier'>,
): CarrierId {
  return parcel.originalCarrier ?? activeTrackingCarrierId(parcel);
}

/** Distinct numbers in delivery-first order, including carriers without a website. */
export function parcelTrackingNumbers(parcel: Pick<TrackedParcel,
  'carrier' | 'trackingNumber' | 'trackingSource' | 'activeTrackingNumber' | 'originalCarrier' | 'originalTrackingNumber'
>): { carrier: CarrierId; number: string }[] {
  const delivery = { carrier: activeTrackingCarrierId(parcel), number: parcel.activeTrackingNumber ?? parcel.trackingNumber };
  const original = { carrier: parcel.originalCarrier ?? parcel.carrier, number: parcel.originalTrackingNumber ?? parcel.trackingNumber };
  return delivery.number === original.number ? [delivery] : [delivery, original];
}

/** Link to the source of the displayed result, never a speculative routing preference. */
export function parcelTrackingLinks(
  parcel: Parameters<typeof carrierTrackingLinks>[0], locale?: string,
): ParcelTrackingLink[] {
  if (requiresAmazonAccount(parcel.carrier, parcel.trackingNumber)) {
    const carrier = carrierInfo('amazon-logistics', locale);
    return [{ carrier, name: carrier.name, url: amazonOrdersUrl(parcel.trackingNumber), active: true, ready: true, role: 'active' }];
  }
  const links = carrierTrackingLinks(parcel, locale);
  const number = encodeURIComponent(parcel.originalCarrier && parcel.trackingSource
    ? parcel.activeTrackingNumber ?? parcel.trackingNumber : parcel.trackingNumber);
  const provider = parcel.trackingProvider;
  const url = provider === '17TRACK' ? `https://t.17track.net/en#nums=${number}`
    : provider === 'ParcelsApp' ? `https://parcelsapp.com/en/tracking/${number}`
    : provider === 'Ship24' ? `https://www.ship24.com/tracking?p=${number}`
    // Postal Ninja's verified public entry point; no guessed session/private URL.
    : provider === 'Postal Ninja' ? 'https://postal.ninja/en/track' : undefined;
  if (!url || !provider) return links;
  const primary: ParcelTrackingLink = { carrier: carrierInfo('unknown', locale), name: provider,
    url: localizedCarrierUrl('unknown', url, locale), active: true, ready: true, role: 'active' };
  return [primary, ...links.filter((link) => link.role !== 'active' && link.url !== primary.url)];
}

/** Primary delivery tracker first, followed by the earlier international journey. */
function carrierTrackingLinks(
  parcel: Pick<
    TrackedParcel,
    | 'carrier'
    | 'trackingNumber'
    | 'trackingUrl'
    | 'trackingSource'
    | 'trackingProvider'
    | 'activeTrackingNumber'
    | 'swissPostReady'
    | 'originalCarrier'
    | 'originalTrackingNumber'
    | 'originalTrackingUrl'
  >,
  locale?: string,
): ParcelTrackingLink[] {
  if (parcel.originalCarrier && parcel.originalTrackingNumber) {
    const active = parcelTrackingLinks({
      carrier: activeTrackingCarrierId(parcel), trackingNumber: parcel.activeTrackingNumber ?? parcel.trackingNumber,
      trackingUrl: activeTrackingCarrierId(parcel) === parcel.carrier
        && (!parcel.activeTrackingNumber || parcel.activeTrackingNumber === parcel.trackingNumber) ? parcel.trackingUrl : undefined,
    }, locale);
    const original = parcelTrackingLinks({
      carrier: parcel.originalCarrier, trackingNumber: parcel.originalTrackingNumber,
      trackingUrl: parcel.originalTrackingUrl,
    }, locale).map((link) => ({ ...link, active: false, role: 'history' as const }));
    return [...active, ...original];
  }
  if (!supportsSwissPostHandoff(parcel.trackingNumber)) {
    const carrier = carrierInfo(activeTrackingCarrierId(parcel), locale);
    const number = parcel.activeTrackingNumber ?? parcel.trackingNumber;
    // Repair obsolete generated links saved by earlier app versions.
    let savedUrl = requiresAmazonAccount(carrier.id, number) || carrier.id === 'intl-post' || carrier.id !== parcel.carrier
      || number !== parcel.trackingNumber ? undefined : parcel.trackingUrl;
    if (parcel.carrier === 'spring-gds' && savedUrl) {
      try {
        const saved = new URL(savedUrl);
        if (saved.hostname === 'postnl.post' && saved.pathname.startsWith('/details/')) {
          savedUrl = undefined;
        }
      } catch {
        // Leave other saved URLs to the existing link validation.
      }
    }
    const url = savedUrl ?? carrier.trackingUrl?.(number);
    return url ? [{
      carrier,
      name: carrier.trackingSiteName ?? carrier.name,
      url: localizedCarrierUrl(carrier.id, url, locale),
      active: true,
      ready: true,
      role: 'active',
    }] : [];
  }

  const activeCarrier = activeTrackingCarrierId(parcel);
  const swissPostReady = parcel.swissPostReady === true || activeCarrier === 'swiss-post';
  const links = (['aliexpress', 'swiss-post'] as const).map((carrierId) => {
    const carrier = carrierInfo(carrierId, locale);
    const active = carrierId === activeCarrier;
    const ready = carrierId !== 'swiss-post' || swissPostReady;
    return {
      carrier,
      name: carrier.trackingSiteName ?? carrier.name,
      url: localizedCarrierUrl(
        carrier.id,
        carrier.trackingUrl!(parcel.trackingNumber),
        locale,
      ),
      active,
      ready,
      role: active ? 'active' as const : ready ? 'history' as const : 'waiting' as const,
    };
  });
  return links.sort((first, second) => Number(second.active) - Number(first.active));
}

/** Point a carrier portal at the reader's language when the site supports it. */
export function localizedCarrierUrl(
  carrierId: CarrierId,
  url: string,
  locale?: string,
): string {
  if (!locale || !['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'].includes(locale)) return url;
  try {
    const localizedUrl = new URL(url);
    if (carrierId === 'swiss-post') {
      localizedUrl.searchParams.set('lang', ['en', 'de', 'fr', 'it'].includes(locale) ? locale : 'en');
    } else if (localizedUrl.hostname === 't.17track.net' || localizedUrl.hostname === 'parcelsapp.com') {
      // Parcels supports Spanish and Portuguese, but has no Polish page.
      const siteLocale = localizedUrl.hostname === 'parcelsapp.com' && locale === 'pl' ? 'en' : locale;
      localizedUrl.pathname = localizedUrl.pathname.replace(/^\/[a-z]{2}(?=\/|$)/i, `/${siteLocale}`);
    } else {
      return url;
    }
    return localizedUrl.toString();
  } catch {
    return url;
  }
}
