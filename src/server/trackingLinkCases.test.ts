import { describe, expect, it } from 'vitest';
import contract from '../../contracts/openapi.json';
import { parcelTrackingLinks } from '../lib/carriers';
import type { CarrierId } from '../types';
import { trackingLinkCases, uncheckedTrackingLinks } from './trackingLinkCases';

function linkHost(carrier: CarrierId, number: string, provider?: string): string | undefined {
  const [link] = parcelTrackingLinks({ carrier, trackingNumber: number, trackingProvider: provider }, 'en');
  return link && new URL(link.url).hostname;
}

// People track these carriers on the carrier's own page: they have a dedicated
// adapter or no automatic tracking. Universal carriers are tracked through
// shared providers, whose links the provider cases cover.
const carrierOwned = Object.entries(contract['x-carriers'])
  .filter(([, carrier]) => carrier.tracking.mode !== 'automatic' || carrier.tracking.adapter !== 'universal')
  .map(([id]) => id as CarrierId);
const checkedHosts = new Set(trackingLinkCases.map((item) => linkHost(item.carrier, item.number, item.provider)));

describe('rendered tracking link coverage', () => {
  it('opens every carrier-owned tracking page daily or records why it cannot', () => {
    const unchecked = carrierOwned.filter((carrier) => {
      const host = linkHost(carrier, 'ZZ0000000000');
      return host !== undefined && !checkedHosts.has(host) && !uncheckedTrackingLinks[carrier];
    });
    expect(unchecked, 'Add a case to trackingLinkCases or a reason to uncheckedTrackingLinks').toEqual([]);
  });

  it('keeps exclusions only for carrier-owned links no case opens', () => {
    for (const carrier of Object.keys(uncheckedTrackingLinks) as CarrierId[]) {
      expect(carrierOwned).toContain(carrier);
      expect(checkedHosts.has(linkHost(carrier, 'ZZ0000000000'))).toBe(false);
    }
  });

  it('forwards each synthetic number unless the case says the link carries none', () => {
    for (const item of trackingLinkCases) {
      const [link] = parcelTrackingLinks({
        carrier: item.carrier, trackingNumber: item.number, trackingProvider: item.provider,
      }, 'en');
      expect(link, item.carrier).toBeDefined();
      if (item.forwarding !== 'none') expect(link!.url, item.carrier).toContain(item.number);
    }
  });
});
