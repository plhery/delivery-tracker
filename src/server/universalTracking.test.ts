import { describe, expect, it, vi } from 'vitest';
import { isUnannouncedTrackingError, CarrierTrackingAdapter } from './trackingSync';
import { UniversalTrackingError } from 'universal-parcel-scraper/node';

// The providers themselves live in Universal Parcel Scraper; this file keeps
// the host-side dispatch into the universal chain under test.
const number = 'ZZ12345678900';

describe('universal tracking dispatch', () => {
  it('dispatches unknown and international postal carriers to automatic lookup', async () => {
    const adapter = new CarrierTrackingAdapter();
    const spy = vi.spyOn(adapter.universal, 'fetch').mockResolvedValue({ status: 'delivered', current_stage: 'delivered' });
    for (const carrier of ['unknown', 'intl-post']) {
      expect(await adapter.fetch(carrier, number, 'https://untrusted.test')).toMatchObject({ current_stage: 'delivered' });
    }
    expect(spy).toHaveBeenCalledTimes(2);
    // The third argument is the lookup's signal and budget, which the scraper passes on.
    expect(spy).toHaveBeenCalledWith(number, null, expect.any(Object));
    // A carrier without an adapter of its own passes its postcode to the providers.
    await adapter.fetch('omgo', number, null, '01234');
    expect(spy).toHaveBeenLastCalledWith(number, '01234', expect.any(Object));
  });

  it('dispatches the added regional carriers without falling back to a generic adapter', async () => {
    const adapter = new CarrierTrackingAdapter();
    const expected = { status: 'delivered' as const, current_stage: 'delivered' };
    // Spy at the public registry boundary; parser tests live in the scraper.
    const hermes = vi.spyOn(adapter.registry.for('hermes-de')!, 'track').mockResolvedValue(expected);
    const gls = vi.spyOn(adapter.registry.for('gls-de')!, 'track').mockResolvedValue(expected);
    const laPoste = vi.spyOn(adapter.registry.for('delivengo')!, 'track').mockResolvedValue(expected);
    await adapter.fetch('hermes-de', 'H1234567890123456789', null);
    await adapter.fetch('gls-de', '12345678901', null, '01067');
    await adapter.fetch('delivengo', 'LD123456785FR', null);
    expect(hermes).toHaveBeenCalledWith({ number: 'H1234567890123456789', trackingUrl: null, postcode: null });
    expect(gls).toHaveBeenCalledWith({ number: '12345678901', trackingUrl: null, postcode: '01067' });
    expect(laPoste).toHaveBeenCalledWith({ number: 'LD123456785FR', trackingUrl: null, postcode: null });
  });

  it('does not treat an exhausted provider chain as an unannounced shipment', () => {
    const error = new UniversalTrackingError([
      { source: 'Ship24', reason: 'history unavailable', error: new Error('Unavailable') },
      { source: 'ParcelsApp', reason: 'history unavailable', error: new Error('Unavailable') },
    ]);
    expect(isUnannouncedTrackingError(error)).toBe(false);
    expect(String(error)).toContain('Ship24');
  });
});
