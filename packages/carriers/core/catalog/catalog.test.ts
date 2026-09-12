import { describe, expect, it } from 'vitest';
import {
  AUTOMATIC_CARRIER_IDS,
  CARRIERS,
  CARRIER_NAMES,
  SELECTABLE_CARRIERS,
  TRACKING_LINK_RULES,
  activeRequirements,
  carrierAdapter,
  carrierDefinition,
  carrierInfo,
  carrierLinkRules,
  carrierRequirements,
  carrierTimezone,
  localizedCarrierUrl,
  parcelTrackingLinks,
  tracksAutomatically,
  trackingNumberForLink,
} from './index';

/**
 * Per-carrier expectations stay in src/lib/carriers.test.ts. What this file
 * covers is the derivation itself: the fields `CARRIERS` computes from the
 * generated catalog and the lookups the server reads from it.
 */
describe('the derived CARRIERS record', () => {
  it('carries the catalog fields and a portal link built from the template', () => {
    expect(CARRIERS['swiss-post']).toMatchObject({
      id: 'swiss-post',
      name: 'Swiss Post',
      capabilities: { selectable: true, timezone: 'Europe/Zurich', tracking: { mode: 'automatic', adapter: 'upstream' } },
    });
    expect(CARRIERS['swiss-post'].trackingUrl?.('RA123456785CH'))
      .toBe('https://service.post.ch/ekp-web/ui/entry/search/RA123456785CH');
    expect(SELECTABLE_CARRIERS.every((carrier) => carrier.capabilities.selectable)).toBe(true);
    expect(tracksAutomatically('swiss-post')).toBe(true);
  });

  it('translates the placeholder carrier names and falls back to the unknown carrier', () => {
    expect(carrierInfo('unknown', 'fr').name).toBe('Transporteur inconnu');
    expect(carrierInfo('unknown').name).toBe(CARRIERS.unknown.name);
    expect(carrierInfo('not-a-carrier' as 'unknown').id).toBe('unknown');
  });

  it('shortens the numbers whose portal expects a different form', () => {
    expect(trackingNumberForLink('mondial-relay', '12123456780101006623123454')).toBe('121234567801');
    expect(trackingNumberForLink('c-chez-vous', 'ABC12345678-75001')).toBe('ABC12345678--75001');
    expect(trackingNumberForLink('swiss-post', 'RA123456785CH')).toBe('RA123456785CH');
  });
});

describe('the catalog lookups the server reads', () => {
  it('answers timezone, adapter and automatic-carrier questions', () => {
    expect(carrierTimezone('swiss-post')).toBe('Europe/Zurich');
    expect(carrierAdapter('swiss-post')).toBe('upstream');
    expect(carrierAdapter('amazon-logistics')).toBeNull();
    expect(AUTOMATIC_CARRIER_IDS.has('swiss-post')).toBe(true);
    expect(AUTOMATIC_CARRIER_IDS.has('amazon-logistics')).toBe(false);
    expect(CARRIER_NAMES.get('swiss-post')).toBe('Swiss Post');
    expect(() => carrierDefinition('not-a-carrier')).toThrow(RangeError);
  });

  it('anchors the server requirement filter and leaves the form filter unanchored', () => {
    // A 26-digit Mondial Relay label barcode carries its own check digits.
    expect(activeRequirements('mondial-relay', '12123456780101006623123454')).toEqual([]);
    expect(activeRequirements('mondial-relay', '12345678').map((item) => item.validator)).toEqual(['francePostcode']);
    expect(carrierRequirements('mondial-relay', '12345678').map((item) => item.field)).toEqual(['dpdPostcode']);
    expect(activeRequirements('swiss-post', 'RA123456785CH')).toEqual([]);
  });
});

describe('tracking links', () => {
  it('compiles every carrier link rule once', () => {
    expect(TRACKING_LINK_RULES.length).toBeGreaterThan(0);
    expect(carrierLinkRules('swiss-post')[0].domains).toContain('service.post.ch');
    expect(carrierLinkRules('swiss-post')[0].path).toBeInstanceOf(RegExp);
  });

  it('localizes only the portals that support it', () => {
    expect(localizedCarrierUrl('swiss-post', 'https://service.post.ch/x', 'fr')).toContain('lang=fr');
    expect(localizedCarrierUrl('swiss-post', 'https://service.post.ch/x')).toBe('https://service.post.ch/x');
    expect(localizedCarrierUrl('dhl', 'https://www.dhl.com/x', 'fr')).toBe('https://www.dhl.com/x');
  });

  it('links a parcel to the source of its displayed result', () => {
    expect(parcelTrackingLinks({ carrier: 'swiss-post', trackingNumber: 'RA123456785CH' })).toEqual([{
      carrier: CARRIERS['swiss-post'],
      name: 'Swiss Post',
      url: 'https://service.post.ch/ekp-web/ui/entry/search/RA123456785CH',
      active: true,
      ready: true,
      role: 'active',
    }]);
  });
});
