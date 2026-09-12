import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../core/errors';
import { DachserTracker, parseDachserTrackingResponse, validateDachserTrackingUrl } from './adapter';
import { eventLabel, shipmentStatus } from './status';

const WRONG_DACHSER_NUMBER = '12345678';
const WRONG_DACHSER_URL = 'https://customeriberia.dachser.com/customerarea/'
  + 'utilidades/seguimiento-publico/detalle?numeroUnico=12345678'
  + '&hash=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SHIPMENT_NUMBER = '9010000001234';

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
) as Record<string, unknown>;
const inTransit = () => fixture('in-transit');
const nullResult500 = () => fixture('null-result-500');
const capabilities = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

afterEach(() => vi.restoreAllMocks());

describe('Dachser capability URL', () => {
  it('canonicalizes a complete public detail link and rejects anything else', () => {
    expect(validateDachserTrackingUrl(WRONG_DACHSER_URL, WRONG_DACHSER_NUMBER)).toBe(WRONG_DACHSER_URL);
    expect(() => validateDachserTrackingUrl('http://customeriberia.dachser.com/customerarea/utilidades/seguimiento-publico/detalle?numeroUnico=12345678&hash=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', WRONG_DACHSER_NUMBER))
      .toThrow('must use https://customeriberia.dachser.com');
    expect(() => validateDachserTrackingUrl(WRONG_DACHSER_URL, '87654321'))
      .toThrow('belongs to a different tracking number');
    expect(() => validateDachserTrackingUrl('https://customeriberia.dachser.com/customerarea/utilidades/seguimiento-publico/detalle?numeroUnico=12345678', WRONG_DACHSER_NUMBER))
      .toThrow('must include its access parameters');
    expect(() => validateDachserTrackingUrl('https://customeriberia.dachser.com/customerarea/utilidades/seguimiento-publico/detalle?numeroUnico=12345678&hash=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&unexpected=1', WRONG_DACHSER_NUMBER))
      .toThrow('unsupported parameter');
  });
});

describe('Dachser response normalization', () => {
  it('keeps only normalized status and event data', () => {
    const result = parseDachserTrackingResponse(inTransit(), SHIPMENT_NUMBER);
    expect(result).toMatchObject({
      status: 'in_transit',
      last_status_text: 'In transit',
      last_update: '2026-09-12T07:45:00+02:00',
      expected_delivery: '2026-09-15',
      timezone: 'Europe/Madrid',
    });
    expect(result.events).toEqual([
      { time: '2026-09-12T07:45:00+02:00', location: '', stage: 'in_transit', description: 'Shipment departed a Dachser facility' },
      { time: '2026-09-11T18:20:00+02:00', location: '', stage: 'in_transit', description: 'Shipment arrived at a Dachser facility' },
      { time: '2026-09-11T09:05:00+02:00', location: '', stage: 'accepted', description: 'Shipment accepted by Dachser' },
      { time: '2026-09-10T16:00:00+02:00', location: '', stage: 'registered', description: 'Shipment registered by Dachser' },
    ]);
  });

  it('discards sender, recipient, contact, signature and internal notes', () => {
    const serialized = JSON.stringify(parseDachserTrackingResponse(inTransit(), SHIPMENT_NUMBER));
    for (const privateValue of [
      'PRIVATE SENDER SL',
      'PRIVATE RECIPIENT',
      'PRIVATE STREET 12',
      '+34000000000',
      'private@example.test',
      'PRIVATE SIGNATURE',
      'PRIVATE INTERNAL NOTE',
    ]) expect(serialized).not.toContain(privateValue);
  });

  it('covers every capability declared in carrier.json', () => {
    expect(capabilities).toEqual(['history', 'eta']);
    const result = parseDachserTrackingResponse(inTransit(), SHIPMENT_NUMBER);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.expected_delivery).toBe('2026-09-15');
  });

  it('classifies a negative or rescheduled notice before the delivery word it contains', () => {
    expect(eventLabel('EXPEDICION NO ENTREGADA')).toMatchObject({ stage: 'failed_attempt' });
    expect(eventLabel('NUEVA FECHA DE ENTREGA')).toMatchObject({ stage: 'in_transit' });
    expect(eventLabel('EXPEDICION ENTREGADA')).toMatchObject({ stage: 'delivered' });
    expect(shipmentStatus('ENTREGADA', true)).toEqual({ status: 'delivered', text: 'Delivered' });
    expect(shipmentStatus('', false)).toEqual({ status: 'unknown', text: 'Tracking update unavailable' });
  });

  it('drops the estimate once the shipment is delivered and rejects a different shipment', () => {
    const delivered = { ...inTransit(), estadoExpedicion: 'ENTREGADA' };
    expect(parseDachserTrackingResponse(delivered, SHIPMENT_NUMBER))
      .toMatchObject({ status: 'delivered', expected_delivery: null });
    expect(() => parseDachserTrackingResponse({ ...inTransit(), numUnico: '9010000009999' }, SHIPMENT_NUMBER))
      .toThrow('different shipment');
    expect(() => parseDachserTrackingResponse({}, SHIPMENT_NUMBER))
      .toThrow('did not return a shipment number');
  });
});

describe('Dachser no-data response', () => {
  it('maps the public endpoint null-result signature to a privacy-safe 404', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify(nullResult500()),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(new DachserTracker({ timeoutMs: 1_000 }).fetch(WRONG_DACHSER_NUMBER, WRONG_DACHSER_URL))
      .rejects.toBeInstanceOf(NotFoundError);
    const request = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(request.pathname).toBe('/api/utilidades/seguimiento-publico/detalle');
    expect(request.searchParams.get('numeroUnico')).toBe(WRONG_DACHSER_NUMBER);
  });

  it('does not misclassify unrelated upstream failures as no data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'ERR_APP_500',
      message: 'Database unavailable',
    }), { status: 500 }));

    await expect(new DachserTracker({ timeoutMs: 1_000 }).fetch(WRONG_DACHSER_NUMBER, WRONG_DACHSER_URL))
      .rejects.toMatchObject({
        name: 'UpstreamHttpError',
        status: 500,
        message: 'Dachser tracking returned HTTP 500',
      });
  });

  it('keeps Dachser\'s current generic null-message 500 indeterminate', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'ERR_APP_500',
      message: null,
      path: '/api/utilidades/seguimiento-publico/detalle',
    }), { status: 500 }));

    await expect(new DachserTracker({ timeoutMs: 1_000 }).fetch(WRONG_DACHSER_NUMBER, WRONG_DACHSER_URL))
      .rejects.toMatchObject({
        name: 'UpstreamHttpError',
        status: 500,
        message: 'Dachser tracking returned HTTP 500',
      });
  });
});
