import { describe, expect, it, vi } from 'vitest';
import { isUnannouncedTrackingError, CarrierTrackingAdapter } from './trackingSync';
import { UniversalTrackingError } from './universalTracking';
import { HermesGermanyTracker } from './hermesGermany';
import { GLSGermanyTracker } from './glsGermany';
import { LaPosteTracker } from './laPoste';

// The providers themselves live in packages/carriers/providers; this file keeps
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
    expect(spy).toHaveBeenCalledWith(number, null);
    await adapter.fetch('bpost', number, null, '01234');
    expect(spy).toHaveBeenLastCalledWith(number, '01234');
  });

  it('dispatches the added regional carriers without falling back to a generic adapter', async () => {
    const adapter = new CarrierTrackingAdapter();
    const expected = { status: 'delivered' as const, current_stage: 'delivered' };
    // The registry builds its own tracker instances, so spy on the prototypes.
    const hermes = vi.spyOn(HermesGermanyTracker.prototype, 'fetch').mockResolvedValue(expected);
    const gls = vi.spyOn(GLSGermanyTracker.prototype, 'fetch').mockResolvedValue(expected);
    const laPoste = vi.spyOn(LaPosteTracker.prototype, 'fetch').mockResolvedValue(expected);
    await adapter.fetch('hermes-de', 'H1234567890123456789', null);
    await adapter.fetch('gls-de', '12345678901', null, '01067');
    await adapter.fetch('delivengo', 'LD123456785FR', null);
    expect(hermes).toHaveBeenCalledWith('H1234567890123456789');
    expect(gls).toHaveBeenCalledWith('12345678901', '01067');
    expect(laPoste).toHaveBeenCalledWith('LD123456785FR');
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
