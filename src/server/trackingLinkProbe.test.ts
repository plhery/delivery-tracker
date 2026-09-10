import { describe, expect, it } from 'vitest';
import { trackingPageVerdict } from './trackingLinkProbe';

const route = /^https:\/\/carrier\.example\/tracking(?:\?|$)/;
const marker = /track your parcel/i;
const page = { status: 200, url: 'https://carrier.example/tracking?number=SYNTHETIC1',
  title: 'Parcel tracker', text: 'Track your parcel. Shipment not found.' };

describe('tracking link page validation', () => {
  it('accepts an actual tracker with an unknown/expired shipment', () => {
    expect(trackingPageVerdict(page, route, marker)).toBe('tracking-page');
  });
  it.each([404, 410, 500, 503])('rejects HTTP %s even with a tracking marker', (status) => {
    expect(trackingPageVerdict({ ...page, status }, route, marker)).toBe('broken');
  });
  it('does not mistake an ordinary reCAPTCHA footer for a challenge', () => {
    expect(trackingPageVerdict({ ...page, text: page.text + ' Protected by reCAPTCHA.' }, route, marker))
      .toBe('tracking-page');
  });
  it('rejects a soft 404 returned with HTTP 200', () => {
    expect(trackingPageVerdict({ ...page, title: 'Page not found' }, route, marker)).toBe('broken');
  });
  it('rejects a homepage redirect even if navigation includes tracking words', () => {
    expect(trackingPageVerdict({ ...page, url: 'https://carrier.example/' }, route, marker)).toBe('broken');
  });
  it('does not count an empty SPA shell as verified', () => {
    expect(trackingPageVerdict({ ...page, text: '' }, route, marker)).toBe('unverified');
  });
  it.each([200, 403, 429])('reports a challenge (%s) as blocked, never healthy', (status) => {
    expect(trackingPageVerdict({ ...page, status, title: 'Just a moment...' }, route, marker)).toBe('blocked');
  });
});
