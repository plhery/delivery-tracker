import postcodes from '../../shared/postcode-examples.json';
import { carrierInfo, type CarrierInputRequirement } from './carriers';
import type { CarrierId } from '../types';

const EXAMPLES: Readonly<Record<string, string>> = postcodes.examples;
const TIME_ZONES: Readonly<Record<string, string>> = postcodes.timeZones;

/**
 * The country this device is set up for: its clock's when one country keeps
 * that time, otherwise the first region its languages name ("en-US").
 */
export function deviceCountry(
  timeZone: string | undefined = Intl.DateTimeFormat().resolvedOptions().timeZone,
  languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language],
): string | null {
  if (timeZone && Object.hasOwn(TIME_ZONES, timeZone)) return TIME_ZONES[timeZone]!;
  for (const language of languages) {
    const region = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(language)?.[1]?.toUpperCase();
    if (region && Object.hasOwn(EXAMPLES, region)) return region;
  }
  return null;
}

/**
 * The example shown in a carrier's field. A national carrier states its own
 * postcode; one that takes any country's leaves it out and shows the reader's
 * country, or the carrier's own when the device does not tell.
 */
export function postcodeExample(
  carrierId: CarrierId,
  requirement: Pick<CarrierInputRequirement, 'field' | 'placeholder'>,
  country: string | null = deviceCountry(),
): string | undefined {
  if (requirement.field !== 'dpdPostcode' || requirement.placeholder) return requirement.placeholder;
  return [country, ...carrierInfo(carrierId).countries]
    .map((code) => (code && Object.hasOwn(EXAMPLES, code) ? EXAMPLES[code] : undefined))
    .find(Boolean);
}

/** A postcode field that takes letters: shown in capitals, as carriers print them. */
export function lettersPostcode(requirement: Pick<CarrierInputRequirement, 'field' | 'inputMode'>): boolean {
  return requirement.field === 'dpdPostcode' && requirement.inputMode !== 'numeric';
}
