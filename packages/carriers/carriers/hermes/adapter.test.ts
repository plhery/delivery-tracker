import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../core/errors';
import { HermesTracker, parseHermesTrackingResponse } from './adapter';
import { hermesStatus } from './status';

const WRONG_HERMES_NUMBER = '12345678';
const DELIVERED_NUMBER = '62162057330000611';

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
) as Record<string, unknown>;
const emptyOrder = () => fixture('empty-order');
const delivered = () => fixture('delivered');
const capabilities = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

afterEach(() => vi.restoreAllMocks());

describe('Hermes no-data response', () => {
  it('rejects the official empty-order placeholder as a privacy-safe 404', () => {
    expect(() => parseHermesTrackingResponse(emptyOrder(), WRONG_HERMES_NUMBER))
      .toThrow(NotFoundError);
    try {
      parseHermesTrackingResponse(emptyOrder(), WRONG_HERMES_NUMBER);
    } catch (error) {
      expect(error).toMatchObject({
        name: 'NotFoundError',
        status: 404,
        message: 'Hermes could not locate the shipment',
      });
      expect(String(error)).not.toContain(WRONG_HERMES_NUMBER);
    }
  });

  it('does not accept an empty object as a pending shipment', () => {
    expect(() => parseHermesTrackingResponse({}, WRONG_HERMES_NUMBER))
      .toThrow('Hermes returned an invalid tracking response');
  });

  it('rejects a non-empty response for a different shipment', () => {
    const otherShipment = {
      body: {
        auftragsdaten: {
          lieferscheinnummer: '87654321',
          statusjourneyDto: {
            statusdaten: [{
              sendungsstatusId: 20_000,
              sendungsstatus: 'Unterwegs',
              sendungsstatusBuchungszeitpunkt: '2026-08-30T12:00:00+02:00',
            }],
          },
        },
      },
    };
    expect(() => parseHermesTrackingResponse(otherShipment, WRONG_HERMES_NUMBER))
      .toThrow('Hermes returned a different shipment');
  });

  it('normalizes the public Hermes status IDs', () => {
    expect([
      [40, 'pending'],
      [100, 'in_transit'],
      [430, 'out_for_delivery'],
      [700, 'delivered'],
      [702, 'delivered'],
      [742, 'delivered'],
      [318, 'exception'],
    ].map(([statusId]) => hermesStatus(statusId))).toEqual([
      'pending',
      'in_transit',
      'out_for_delivery',
      'delivered',
      'delivered',
      'delivered',
      'exception',
    ]);
  });

  it('parses a sanitized fixture from Hermes\'s public delivered sample', () => {
    const result = parseHermesTrackingResponse(delivered(), DELIVERED_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      last_update: '2026-08-05 12:50',
      last_status_text: 'Deine Sendung wurde erfolgreich zugestellt.',
    });
    expect(result.events).toHaveLength(1);
    expect(result.events?.[0]).toMatchObject({ stage: 'delivered' });
    expect(result.events?.some((event) => event.description === 'Tracking update')).toBe(false);
  });

  it('covers every capability declared in carrier.json', () => {
    const result = parseHermesTrackingResponse(delivered(), DELIVERED_NUMBER);
    expect(capabilities).toEqual(['history', 'eta']);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.expected_delivery).toBe('2026-08-05');
  });

  it('never projects the internal operational stream or an order reference', () => {
    const serialized = JSON.stringify(parseHermesTrackingResponse(delivered(), DELIVERED_NUMBER));
    for (const internalValue of [
      'Ware geliefert.',
      'Ihre Sendung wurde bei der angegebenen Adresse zugestellt.',
      '66508126',
    ]) expect(serialized).not.toContain(internalValue);
  });

  it('exercises the anonymous API path with a valid-shaped wrong number', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify(emptyOrder()),
      { headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(new HermesTracker({ timeoutMs: 1_000 }).fetch(WRONG_HERMES_NUMBER))
      .rejects.toBeInstanceOf(NotFoundError);
    const request = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(request.origin + request.pathname).toBe('https://myhes.de/api/request/auftragsdaten');
    expect(request.searchParams.get('parcelNumber')).toBe(WRONG_HERMES_NUMBER);
  });
});
