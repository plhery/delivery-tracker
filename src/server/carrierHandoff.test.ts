import { describe, expect, it } from 'vitest';
import { swissPostHandoffNumber } from './carrierHandoff';

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
