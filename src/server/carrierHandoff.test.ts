import { describe, expect, it } from 'vitest';
import { deliveryHandoff, swissPostHandoffNumber } from './carrierHandoff';
import { normalizeCarrierResult } from './carrierResult';

describe('general delivery handoff candidates', () => {
  it('validates generalized result hints against the catalog and country-code shape', () => {
    expect(normalizeCarrierResult({ delivery_carrier: 'posti', destination_country: 'FI' }))
      .toMatchObject({ delivery_carrier: 'posti', destination_country: 'FI' });
    expect(() => normalizeCarrierResult({ delivery_carrier: 'unregistered-carrier' })).toThrow('unsupported delivery carrier');
    expect(() => normalizeCarrierResult({ destination_country: 'Finland' })).toThrow('invalid destination country');
  });
  it('chooses the declared delivery partner, including a distinct local number', () => {
    expect(deliveryHandoff('la-poste', 'CW123456785FR', {
      destination_country: 'FI', delivery_carrier: 'posti', delivery_tracking_number: 'LOCAL12345',
    })).toEqual({ carrier: 'posti', number: 'LOCAL12345', explicit: true });
    expect(deliveryHandoff('la-poste', 'CW123456785FR', { delivery_carrier: 'usps' })?.carrier).toBe('usps');
  });
  it('uses destination evidence for postal numbers without reading the issuer suffix as a destination', () => {
    expect(deliveryHandoff('la-poste', 'CW123456785FR', { destination_country: 'FI' }))
      .toEqual({ carrier: 'posti', number: 'CW123456785FR', explicit: false });
    expect(deliveryHandoff('la-poste', 'CW123456785FR', { destination_country: 'XX' })).toBeNull();
    expect(deliveryHandoff('dhl', '1234567890', { destination_country: 'FI' })).toBeNull();
    expect(swissPostHandoffNumber('la-poste', 'CW123456785FR', { destination_country: 'FI' })).toBeNull();
  });
  it('requires a dedicated adapter and never borrows another carrier’s credentials', () => {
    for (const delivery_carrier of ['postnord', 'dpd', 'amazon-logistics', 'not-a-carrier', 'la-poste']) {
      expect(deliveryHandoff('la-poste', 'CW123456785FR', { delivery_carrier })).toBeNull();
    }
    expect(deliveryHandoff('la-poste', 'CW123456785FR', { delivery_carrier: 'posti', delivery_tracking_number: 'bad?number' })).toBeNull();
  });
});

describe('Swiss Post handoff candidates', () => {
  it.each(['aliexpress', 'spring-gds', 'sunyou', 'dhl', 'intl-post'])('accepts valid foreign-issued postal identifiers from %s', (carrier) => {
    expect(swissPostHandoffNumber(carrier, 'LX123456785NL', {})).toBe('LX123456785NL');
    expect(swissPostHandoffNumber(carrier, 'LX123456789NL', {})).toBeNull();
  });
  it('uses a provider-supplied delivery reference', () => {
    expect(swissPostHandoffNumber('gls-de', '123456789011', {
      delivery_carrier: 'swiss-post', delivery_tracking_number: '12345678901',
    })).toBe('12345678901');
  });
  it('recognizes an explicit official partner link from any adapter', () => {
    expect(swissPostHandoffNumber('aliexpress', 'OTHER12345', {
      events: [{ description: 'Delivery partner tracking: https://service.post.ch/ekp-web/ui/list' }],
    })).toBe('OTHER12345');
  });
  it.each(['https://post.ch.evil.test', 'https://post.ch@evil.test', 'https://evil.test/post.ch', 'Swiss Post maybe'])('does not trust ambiguous partner text: %s', (description) => {
    expect(swissPostHandoffNumber('aliexpress', 'OTHER12345', { last_status_text: description })).toBeNull();
  });
  it('does not probe arbitrary numeric parcels or the current Swiss carrier', () => {
    expect(swissPostHandoffNumber('gls-de', '12345678901', {})).toBeNull();
    expect(swissPostHandoffNumber('swiss-post', 'LX123456785NL', { delivery_carrier: 'swiss-post' })).toBeNull();
  });
});
