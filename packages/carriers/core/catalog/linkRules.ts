/**
 * Compiled tracking-link rules.
 *
 * What it is: every carrier's `linkRules` with their regexes compiled once, so
 * a pasted URL can be matched against the whole catalog.
 * What it is not: no fetching, no URL following, no provider I/O. Matching a
 * URL against these rules lives in `core/detection`.
 */
import type { CarrierId } from '../../generated/catalog';
import { CARRIER_DEFINITIONS } from './definitions';

export interface TrackingLinkRule {
  carrier: CarrierId;
  domains: string[];
  params?: string[];
  path?: RegExp;
  pathPattern?: RegExp;
  fragment?: RegExp;
  detectFromNumber?: boolean;
  keepsCapabilityUrl?: boolean;
}

export const TRACKING_LINK_RULES: TrackingLinkRule[] = Object.entries(CARRIER_DEFINITIONS)
  .flatMap(([carrier, definition]) => definition.linkRules.map((rule) => ({
    carrier: carrier as CarrierId,
    domains: [...rule.domains],
    params: rule.params ? [...rule.params] : undefined,
    path: rule.path ? new RegExp(rule.path, 'i') : undefined,
    pathPattern: rule.pathPattern ? new RegExp(rule.pathPattern, 'i') : undefined,
    fragment: rule.fragment ? new RegExp(rule.fragment, 'i') : undefined,
    detectFromNumber: rule.detectFromNumber,
    keepsCapabilityUrl: rule.keepsCapabilityUrl,
  })));

/** The compiled link rules declared by one carrier. */
export function carrierLinkRules(carrierId: CarrierId): TrackingLinkRule[] {
  return TRACKING_LINK_RULES.filter((rule) => rule.carrier === carrierId);
}

/** A hostname matches a rule domain exactly or as one of its subdomains. */
export function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
