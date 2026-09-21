import { describe, expect, it } from 'vitest';
import { deliveryHandoff } from './carrierHandoff';
import { normalizeCarrierResult, type CarrierResult } from './carrierResult';

describe('general delivery handoff candidates', () => {
  it('keeps tracking history when optional partner evidence is malformed', () => {
    expect(normalizeCarrierResult({ delivery_carrier: 'posti', destination_country: 'FI' }))
      .toMatchObject({ delivery_carrier: 'posti', destination_country: 'FI' });
    for (const hints of [
      { delivery_carrier: 'unregistered-carrier', delivery_tracking_number: 'LOCAL12345' },
      { delivery_carrier: 123 },
      { delivery_carrier: 'posti', delivery_tracking_number: { invalid: true } },
      { delivery_carrier: 'posti', delivery_tracking_number: 'bad?number' },
      { destination_country: 'Finland' },
      { destination_country: 123 },
    ]) {
      const result = normalizeCarrierResult({ status: 'delivered', events: [{ description: 'Delivered' }], ...hints });
      expect(result).toMatchObject({ status: 'delivered', events: [{ description: 'Delivered' }] });
      expect(result.delivery_carrier).toBeUndefined();
      expect(result.delivery_tracking_number).toBeUndefined();
      expect(result.destination_country).toBeUndefined();
    }
  });
  it('chooses the declared delivery partner, including a distinct local number', () => {
    expect(deliveryHandoff('la-poste', 'CW123456785FR', {
      destination_country: 'FI', delivery_carrier: 'posti', delivery_tracking_number: 'LOCAL12345',
    })).toEqual({ carrier: 'posti', number: 'LOCAL12345' });
    expect(deliveryHandoff('la-poste', 'CW123456785FR', { delivery_carrier: 'usps' })?.carrier).toBe('usps');
  });
  it.each(['FI', 'CH', 'XX', undefined])('does not infer a postal operator from destination %s or the issuer suffix', (destination_country) => {
    for (const number of ['CW123456785FR', 'LX123456785CH', '1234567890']) {
      expect(deliveryHandoff('la-poste', number, { destination_country })).toBeNull();
    }
  });
  it('uses the reported operator even when the destination also has another carrier', () => {
    expect(deliveryHandoff('la-poste', 'CW123456785FR', { destination_country: 'FI', delivery_carrier: 'ups' }))
      .toEqual({ carrier: 'ups', number: 'CW123456785FR' });
  });
  it.each([
    ['RA123456785CH', 'swiss-post'], ['1Z1234567890123456', 'ups'], ['CW123456785FR', 'la-poste'],
  ])('preserves an independently reported reference and proposes its catalog carrier: %s', (reference, carrier) => {
    const result = normalizeCarrierResult({ status: 'in_transit', delivery_tracking_number: reference });
    expect(result.delivery_tracking_number).toBe(reference);
    expect(result.delivery_carrier).toBeUndefined();
    expect(deliveryHandoff('aliexpress', 'LP00000000000001', result)).toEqual({ carrier, number: reference });
  });
  it.each(['LOCAL12345', '1234567890', 'RA123456789CH', 'bad?number'])('does not guess from an unrecognized, ambiguous or invalid reference: %s', (reference) => {
    expect(deliveryHandoff('aliexpress', 'LP00000000000001', { delivery_tracking_number: reference })).toBeNull();
  });
  it('lets a reported partner take precedence over number detection', () => {
    expect(deliveryHandoff('aliexpress', 'LX123456785CH', { delivery_tracking_number: 'RA123456785CH', delivery_carrier: 'posti' }))
      .toEqual({ carrier: 'posti', number: 'RA123456785CH' });
  });
  it('limits the historical Swiss probe to its known route and respects a different destination', () => {
    expect(deliveryHandoff('aliexpress', 'LX123456785CH', {})).toEqual({ carrier: 'swiss-post', number: 'LX123456785CH' });
    for (const number of ['LX123456789CH', 'LX123456785NL', 'LP00000000000001']) {
      expect(deliveryHandoff('aliexpress', number, {})).toBeNull();
    }
    expect(deliveryHandoff('aliexpress', 'LX123456785CH', { destination_country: 'FI' })).toBeNull();
    expect(deliveryHandoff('aliexpress', 'LX123456785CH', { destination_country_name: 'Finland' })).toBeNull();
    expect(deliveryHandoff('aliexpress', 'LX123456785CH', { delivery_carrier: 'postnord' })).toBeNull();
  });
  it('ignores malformed persisted hints without throwing during origin recovery', () => {
    expect(deliveryHandoff('aliexpress', 'LX123456785CH', { delivery_tracking_number: 123 } as unknown as CarrierResult)).toBeNull();
    expect(deliveryHandoff('aliexpress', 'LX123456785CH', { destination_country: 123 } as unknown as CarrierResult))
      .toEqual({ carrier: 'swiss-post', number: 'LX123456785CH' });
  });
  it('requires a dedicated adapter and never borrows another carrier’s credentials', () => {
    for (const delivery_carrier of ['postnord', 'dpd', 'amazon-logistics', 'not-a-carrier', 'la-poste']) {
      expect(deliveryHandoff('la-poste', 'CW123456785FR', { delivery_carrier })).toBeNull();
    }
    expect(deliveryHandoff('la-poste', 'CW123456785FR', { delivery_carrier: 'posti', delivery_tracking_number: 'bad?number' })).toBeNull();
  });
});

describe('partner link handoff candidates', () => {
  it('uses a provider-supplied delivery reference', () => {
    expect(deliveryHandoff('gls-de', '123456789011', {
      delivery_carrier: 'swiss-post', delivery_tracking_number: '12345678901',
    })).toEqual({ carrier: 'swiss-post', number: '12345678901' });
  });
  it.each([
    ['aliexpress', 'https://service.post.ch/ekp-web/ui/list', 'swiss-post'],
    ['dhl', 'https://www.posti.fi/en/tracking', 'posti'],
    ['la-poste', 'https://tools.usps.com/go/TrackConfirmAction', 'usps'],
  ])('uses the catalog to resolve %s partner link %s', (carrier, url, target) => {
    expect(deliveryHandoff(carrier, 'OTHER12345', {
      events: [{ description: `Delivery partner tracking: ${url}` }],
    })).toEqual({ carrier: target, number: 'OTHER12345' });
  });
  it.each(['https://post.ch.evil.test', 'https://post.ch@evil.test', 'https://evil.test/post.ch', 'Swiss Post maybe'])('does not trust ambiguous partner text: %s', (description) => {
    expect(deliveryHandoff('aliexpress', 'OTHER12345', { last_status_text: description })).toBeNull();
  });
  it('ignores self-links and conflicting partner links', () => {
    expect(deliveryHandoff('posti', 'OTHER12345', { last_status_text: 'https://www.posti.fi/en/tracking' })).toBeNull();
    expect(deliveryHandoff('la-poste', 'OTHER12345', { last_status_text: 'https://www.posti.fi/ and https://www.post.ch/' })).toBeNull();
  });
});
