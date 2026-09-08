import { describe, expect, it } from 'vitest';
import { GLSGermanyTracker } from './glsGermany';
import { HermesGermanyTracker } from './hermesGermany';
import { CarrierTrackingAdapter } from './trackingSync';

describe('public forum tracking examples', () => {
  it.runIf(Boolean(process.env.FLARESOLVERR_URL))('finds an unknown-carrier forum parcel using public universal tracking', async () => {
    // https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/
    // ParcelsApp: 32 events, delivered 2026-08-17; verified 2026-09-08.
    const result = await new CarrierTrackingAdapter().fetch('unknown', 'YT2621200705470145', null);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(['17TRACK', 'ParcelsApp']).toContain(result.tracking_provider);
    expect(result.current_stage).not.toBe('pending');
  }, 120_000);

  it('retrieves Hermes history or its explicit retention expiry', async () => {
    // Public Paketda forum sample. Retained delivery history verified 2026-09-08.
    // https://www.paketda.de/fragen-antworten.php?suche_carrier=hermes
    try {
      const result = await new HermesGermanyTracker().fetch('39181147009513');
      expect(result.events?.length).toBeGreaterThan(0);
      expect(result.current_stage).toBeDefined();
      expect(Object.keys(result)).not.toContain('address');
    } catch (error) {
      expect(error).toMatchObject({ name: 'HermesGermanyTrackingError', status: 404 });
    }
  });

  it('recognizes an expired German GLS forum example before requesting private details', async () => {
    // https://www.paketda.de/fragen-antworten.php?suche_carrier=gls
    // The postcode is synthetic; the overview must fail before it is submitted.
    await expect(new GLSGermanyTracker().fetch('28286849236', '00000')).rejects.toMatchObject({
      name: 'GLSGermanyTrackingError', status: 404,
    });
  });

  it('checks the public Delivengo example through the real dispatcher', async () => {
    // Public postal-collector forum, May 2023; normally beyond tracking retention.
    // https://www.philaseiten.de/cgi-bin/index.pl?PR=319289
    try {
      const result = await new CarrierTrackingAdapter().fetch('delivengo', 'LD156008025FR', null);
      expect(result.events?.length).toBeGreaterThan(0);
    } catch (error) {
      if (error instanceof Error && error.name === 'LaPosteTrackingError') {
        expect(error).toMatchObject({ status: 404 });
      } else {
        // La Poste may challenge the local IP, including for retired numbers.
        expect(error).toMatchObject({ name: 'UpstreamHttpError', provider: 'La Poste tracking' });
        expect([403, 404]).toContain((error as { status: number }).status);
      }
    }
  });
});
