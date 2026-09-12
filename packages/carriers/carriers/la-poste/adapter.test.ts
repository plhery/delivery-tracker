import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamHttpError } from '../../core/errors';
import type { StepRecord, StepRecorder } from '../../core/telemetry';
import {
  LaPosteTracker,
  adapter,
  laPosteTrackingApiUrl,
  laPosteTrackingUrl,
  normalizeLaPosteTrackingNumber,
  parseLaPosteTrackingResponse,
} from './adapter';
import { eventStage, eventStatus } from './status';

const TRACKING_NUMBER = 'AB12345678901';
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

interface LaPosteEvent {
  group: string;
  code: string;
  label: string;
  date: string;
  country: string;
  order: number;
  recipientAddress?: string;
}
interface LaPosteResponse {
  returnCode: number;
  returnMessage: string;
  shipment: {
    idShip: string;
    product: string;
    isFinal: boolean;
    estimDate: string;
    timeline: Array<{ id: number; shortLabel: string; date: string; status: boolean; code: string }>;
    event: LaPosteEvent[];
  };
}

function deliveredFixture(): LaPosteResponse[] {
  return JSON.parse(
    readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'),
  ) as LaPosteResponse[];
}

function recordingRecorder(): { recorder: StepRecorder; steps: StepRecord[] } {
  const steps: StepRecord[] = [];
  return { steps, recorder: { step: (record) => { steps.push(record); }, lookup() {} } };
}

afterEach(() => vi.restoreAllMocks());

describe('La Poste tracking input', () => {
  it('normalizes domestic and UPU identifiers and builds official URLs', () => {
    expect(normalizeLaPosteTrackingNumber('ab 123.456-78901')).toBe(TRACKING_NUMBER);
    expect(normalizeLaPosteTrackingNumber('RA123456785FR')).toBe('RA123456785FR');
    expect(normalizeLaPosteTrackingNumber('12345678901234q')).toBe('12345678901234Q');

    const page = new URL(laPosteTrackingUrl(TRACKING_NUMBER));
    expect(page.origin).toBe('https://www.laposte.fr');
    expect(page.searchParams.get('code')).toBe(TRACKING_NUMBER);
    const api = new URL(laPosteTrackingApiUrl(TRACKING_NUMBER));
    expect(api.pathname).toBe(`/ssu/sun/back/suivi-unifie/${TRACKING_NUMBER}`);
    expect(api.searchParams.get('lang')).toBe('fr');
  });

  it('rejects unsupported and unsafe identifiers', () => {
    for (const value of [
      '123',
      'AB1234567890',
      'ABCDEFGHIJKLMNO',
      'AB12345678901&lang=en',
      'AB1234567890É',
      'ABCDEFGHIJKLMN1',
    ]) {
      expect(() => laPosteTrackingUrl(value)).toThrow('13- or 15-character');
    }
  });
});

describe('La Poste transient 403 recovery', () => {
  const rejection = () => new Response('<title>Temporary access refusal</title>', {
    status: 403, headers: { 'Content-Type': 'text/html' },
  });

  it('does not retry an explicit carrier maintenance page', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      '<title>Site indisponible - Incident en cours - La Poste</title>', { status: 403 },
    ));
    await expect(new LaPosteTracker().fetch(TRACKING_NUMBER)).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([1, 2])('recovers after %i immediate retries recorded as the retry step', async (failures) => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      fetcher.mock.calls.length <= failures ? rejection() : Response.json(deliveredFixture())
    ));
    const { recorder, steps } = recordingRecorder();

    await expect(new LaPosteTracker({ recorder }).fetch(TRACKING_NUMBER))
      .resolves.toMatchObject({ status: 'delivered' });

    expect(fetcher).toHaveBeenCalledTimes(failures + 1);
    expect(steps.map((step) => step.step))
      .toEqual(['direct', ...Array.from({ length: failures }, () => 'retry')]);
    // Every recovery carries the rejection that caused it, with its bounded
    // response diagnostics, so the host reports each 403 rather than only the last.
    for (const step of steps.slice(1)) {
      expect(step).toMatchObject({ fallbackReason: 'challenge' });
      expect(step.fallbackError).toMatchObject({
        status: 403,
        diagnostics: expect.objectContaining({ body_excerpt: expect.stringContaining('Temporary access refusal') }),
      });
    }
  });

  it('stops after three 403 responses and preserves the last response for router fallback', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => rejection());
    const { recorder, steps } = recordingRecorder();

    await expect(new LaPosteTracker({ recorder }).fetch(TRACKING_NUMBER)).rejects.toMatchObject({
      name: 'UpstreamHttpError', status: 403,
      diagnostics: expect.objectContaining({ body_excerpt: expect.stringContaining('Temporary access refusal') }),
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(steps.map((step) => [step.step, step.outcome]))
      .toEqual([['direct', 'challenge'], ['retry', 'challenge'], ['retry', 'challenge']]);
  });

  it.each([401, 404, 429, 500, 503])('does not retry HTTP %i', async (status) => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
    const { recorder, steps } = recordingRecorder();

    await expect(new LaPosteTracker({ recorder }).fetch(TRACKING_NUMBER))
      .rejects.toBeInstanceOf(UpstreamHttpError);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(steps.map((step) => step.step)).toEqual(['direct']);
  });

  it('stops retrying if a 403 is followed by another failure', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(rejection())
      .mockResolvedValueOnce(new Response('', { status: 429 }));
    await expect(new LaPosteTracker().fetch(TRACKING_NUMBER)).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry malformed successful responses', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid json'));
    await expect(new LaPosteTracker().fetch(TRACKING_NUMBER)).rejects.toThrow('invalid tracking response');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('shares the original deadline and stops when a retry exhausts it', async () => {
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      elapsed += 600.25;
      return rejection();
    });

    await expect(new LaPosteTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ status: 403 });

    expect(fetcher).toHaveBeenCalledTimes(2);
    // Each attempt bounds twice: once for the runner's remaining budget and
    // once for the request itself, both from the same original deadline.
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([1_000, 1_000, 399, 399]);
  });
});

describe('La Poste response normalization', () => {
  it('sorts events, maps the official group, and excludes response PII', () => {
    const result = parseLaPosteTrackingResponse(deliveredFixture(), TRACKING_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      last_status_text: 'Colis livré au destinataire',
      last_update: '2026-01-08T11:14:50+01:00',
      expected_delivery: null,
      timezone: 'Europe/Paris',
    });
    expect(result.events).toEqual([
      {
        time: '2026-01-08T11:14:50+01:00',
        location: 'FR',
        description: 'Colis livré au destinataire',
        stage: 'delivered',
        provider_code: 'DESBAL/DI1',
      },
      {
        time: '2026-01-07T10:42:00+01:00',
        location: 'FR',
        description: 'Votre colis est en transit',
        stage: 'in_transit',
        provider_code: 'ACHNAT/TR1',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('must never survive');
  });

  it('returns every declared capability from one fixture', () => {
    const fixture = deliveredFixture();
    fixture[0]!.shipment.isFinal = false;
    const result = parseLaPosteTrackingResponse(fixture, TRACKING_NUMBER);

    expect(CAPABILITIES).toEqual(['history', 'location', 'eta', 'provider_code']);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.events?.some((event) => event.provider_code)).toBe(true);
    expect(result.expected_delivery).toBe('2026-01-09');
  });

  it('uses timeline data when an announced parcel has no event history', () => {
    const fixture = deliveredFixture();
    fixture[0]!.shipment.isFinal = false;
    fixture[0]!.shipment.event = [];
    fixture[0]!.shipment.timeline = [{
      id: 1,
      shortLabel: 'Information reçue, colis préparé',
      date: '2026-01-02T17:54:00+01:00',
      status: true,
      code: 'ACCEPT',
    }];

    expect(parseLaPosteTrackingResponse(fixture, TRACKING_NUMBER)).toMatchObject({
      status: 'pending',
      last_update: '2026-01-02T17:54:00+01:00',
      events: [],
    });
  });

  it('normalizes Chronopost shipments returned by the same unified API', () => {
    const chronopostNumber = 'PZ123456785JF';
    const fixture = deliveredFixture();
    fixture[0]!.shipment.idShip = chronopostNumber;
    fixture[0]!.shipment.product = 'chronopost';
    fixture[0]!.shipment.event = [{
      group: '',
      code: 'DI1',
      label: 'Livraison effectuée',
      date: '2026-08-13T09:55:00+02:00',
      country: '',
      order: 100,
      recipientAddress: 'must never survive normalization',
    }];

    const result = parseLaPosteTrackingResponse(fixture, chronopostNumber);
    expect(result).toMatchObject({
      status: 'delivered',
      last_status_text: 'Livraison effectuée',
      events: [{ provider_code: 'DI1', stage: 'delivered' }],
    });
    expect(JSON.stringify(result)).not.toContain('must never survive');
  });

  it('uses return semantics rather than treating every final event as delivered', () => {
    const fixture = deliveredFixture();
    fixture[0]!.shipment.event = [{
      group: '',
      code: 'DI2',
      label: 'Colis mis à disposition du vendeur suite à un retour',
      date: '2026-08-14T10:00:00+02:00',
      country: 'FR',
      order: 101,
      recipientAddress: '',
    }];

    expect(parseLaPosteTrackingResponse(fixture, TRACKING_NUMBER)).toMatchObject({
      status: 'exception',
      events: [{ stage: 'returned', provider_code: 'DI2' }],
    });
  });

  it('lets explicit incidents override codes and recognizes pickup readiness', () => {
    const fixture = deliveredFixture();
    fixture[0]!.shipment.isFinal = false;
    fixture[0]!.shipment.event = [{
      group: '',
      code: 'DR1',
      label: 'Incident : livraison impossible',
      date: '2026-08-14T10:00:00+02:00',
      country: 'FR',
      order: 101,
      recipientAddress: '',
    }];
    expect(parseLaPosteTrackingResponse(fixture, TRACKING_NUMBER)).toMatchObject({
      status: 'exception',
      events: [{ stage: 'exception' }],
    });

    fixture[0]!.shipment.event = [{
      group: 'DISMAD',
      code: 'AG1',
      label: 'Votre colis est disponible au point de retrait',
      date: '2026-08-14T11:00:00+02:00',
      country: 'FR',
      order: 102,
      recipientAddress: '',
    }];
    expect(parseLaPosteTrackingResponse(fixture, TRACKING_NUMBER)).toMatchObject({
      status: 'out_for_delivery',
      events: [{ stage: 'ready_for_pickup' }],
    });
  });

  it('does not confuse a delivery driver or a future delivery with delivery', () => {
    const fixture = deliveredFixture();
    fixture[0]!.shipment.isFinal = false;
    fixture[0]!.shipment.event = [{
      group: '',
      code: '',
      label: 'En cours de livraison par le livreur',
      date: '2026-08-14T11:00:00+02:00',
      country: 'FR',
      order: 102,
      recipientAddress: '',
    }];
    expect(parseLaPosteTrackingResponse(fixture, TRACKING_NUMBER)).toMatchObject({
      status: 'out_for_delivery',
      events: [{ stage: 'out_for_delivery' }],
    });

    fixture[0]!.shipment.event[0]!.label = 'Votre colis va être livré prochainement';
    expect(parseLaPosteTrackingResponse(fixture, TRACKING_NUMBER)).toMatchObject({
      status: 'in_transit',
      events: [{ stage: 'in_transit' }],
    });
  });

  it('rejects provider errors and responses for another parcel', () => {
    let providerError: unknown;
    try {
      parseLaPosteTrackingResponse([{
        returnCode: 104,
        returnMessage: 'Unknown shipment',
      }], TRACKING_NUMBER);
    } catch (error) {
      providerError = error;
    }
    expect(providerError).toMatchObject({
      name: 'LaPosteTrackingError',
      kind: 'not_found',
      code: 104,
      message: 'La Poste could not locate the shipment',
      status: 404,
    });
    expect(String(providerError)).not.toContain('Unknown shipment');

    const fixture = deliveredFixture();
    fixture[0]!.shipment.idShip = 'ZZ12345678901';
    expect(() => parseLaPosteTrackingResponse(fixture, TRACKING_NUMBER))
      .toThrow('different shipment');
  });

  it('rejects null provider codes and impossible calendar dates', () => {
    const nullCode = deliveredFixture();
    nullCode[0]!.returnCode = null as unknown as number;
    expect(() => parseLaPosteTrackingResponse(nullCode, TRACKING_NUMBER))
      .toThrow('tracking is unavailable');

    const invalidDates = deliveredFixture();
    invalidDates[0]!.shipment.isFinal = false;
    invalidDates[0]!.shipment.estimDate = '2026-02-30T18:00:00+01:00';
    invalidDates[0]!.shipment.event[1]!.date = '2026-02-30T11:14:50+01:00';
    const result = parseLaPosteTrackingResponse(invalidDates, TRACKING_NUMBER);
    expect(result.expected_delivery).toBeNull();
    expect(result.events?.[0]?.time).toBe('');
  });
});

describe('La Poste status vocabulary', () => {
  it('lets the code outrank the group and incident wording outrank both', () => {
    expect(eventStatus('EXPANN', 'MD1', 'Votre colis est en cours de livraison', true)).toBe('out_for_delivery');
    expect(eventStatus('DESBAL', 'DI1', 'Incident : livraison impossible', true)).toBe('exception');
    expect(eventStage('ACHNAT', 'PC1', 'Votre colis a été pris en charge')).toBe('accepted');
  });
});

describe('La Poste adapter factory', () => {
  it('declares the direct and retry tiers and fetches the bounded official endpoint', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(deliveredFixture()),
    );
    const { recorder } = recordingRecorder();
    const instance = adapter({ trawl: null, browserExecutablePath: null, recorder, env: {} });

    expect(instance.id).toBe('la-poste');
    expect(instance.steps).toEqual(['direct', 'retry']);
    await expect(instance.track({ number: TRACKING_NUMBER })).resolves.toMatchObject({
      status: 'delivered',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [requested, init] = fetcher.mock.calls[0]!;
    expect(new URL(String(requested)).searchParams.get('lang')).toBe('fr');
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
  });
});
