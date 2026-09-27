import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CarrierResult } from '../../core/result';
import {
  fetchPlanzer,
  parsePlanzerTrackingResponse,
  PlanzerTracker,
  planzerShipmentNumber,
} from './adapter';
import { planzerDescription, planzerEventStage } from './status';

const folder = path.dirname(fileURLToPath(import.meta.url));
const carrier = JSON.parse(
  readFileSync(path.join(folder, 'carrier.json'), 'utf8'),
) as { capabilities: string[] };

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(folder, 'fixtures', name), 'utf8'));
}

const QUICKPAC_NUMBER = '440000000000000001';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Planzer and Quickpac transient failures', () => {
  beforeEach(() => vi.useFakeTimers());

  it('recovers from a Quickpac transport timeout without losing shipment validation', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
      .mockResolvedValueOnce(jsonResponse({
        overallStatus: { text: { english: 'Recorded' } },
        transportPositions: [{ positionNumber: QUICKPAC_NUMBER, positionEvents: [] }],
      }));
    const result = fetchPlanzer(QUICKPAC_NUMBER);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toMatchObject({ status: 'pending', events: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('Planzer and Quickpac no-data responses', () => {
  it('keeps both direct tracking number formats and surfaces the API 404', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 404 }));
    const cases = [
      ['12345678901234567890', '12345678901234567890'],
      ['440000000000000000', '440000000000000000'],
    ] as const;

    for (const [trackingNumber, shipmentNumber] of cases) {
      expect(planzerShipmentNumber(trackingNumber)).toBe(shipmentNumber);
      await expect(fetchPlanzer(trackingNumber)).rejects.toMatchObject({
        name: 'UpstreamHttpError',
        status: 404,
        message: 'Planzer tracking returned HTTP 404',
      });
    }

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0]))
      .toContain('/shipments/12345678901234567890/Pak');
    expect(String(fetcher.mock.calls[1]?.[0]))
      .toContain('/shipments/440000000000000000/Pak');
  });

  it('looks up only the shipment half of a reference composite', () => {
    expect(planzerShipmentNumber('ref.000123456')).toBe('123456');
    expect(planzerShipmentNumber('ref.000')).toBe('000');
    // The same composite as the app stores it, without the dot.
    expect(planzerShipmentNumber('12345.0012345678')).toBe('12345678');
    expect(planzerShipmentNumber('123450012345678')).toBe('12345678');
    // Other shapes go to the API unchanged.
    expect(planzerShipmentNumber('123451234567890')).toBe('123451234567890');
    expect(planzerShipmentNumber('12345678')).toBe('12345678');
  });

  it('reads every parcel of a shipment looked up by shipment number, once per milestone', async () => {
    const parcel = (positionNumber: string, times: string[]) => ({
      positionNumber,
      positionEvents: ['Recorded', 'Transferred', 'In delivery', 'Shipped']
        .map((english, index) => ({ createdAt: times[index], text: { english } })),
    });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      shipmentNumber: '12345678',
      overallStatus: { text: { english: 'Shipment delivered' } },
      deliveryAddress: { name: 'Made Up Recipient', street: 'Example Street', houseNumber: '1' },
      transportPositions: [
        parcel('00000000000000000017', ['2026-09-01T13:24:52.0503924', '2026-09-01T17:21:52.001', '2026-09-02T03:54:29.410465', '2026-09-02T11:38:03.275']),
        parcel('00000000000000000024', ['2026-09-01T13:24:52.0503989', '2026-09-01T17:21:55.001', '2026-09-02T03:54:35.0183809', '2026-09-02T11:38:03.275']),
      ],
    }));

    const result = await fetchPlanzer('123450012345678');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/shipments/12345678/Pak');
    expect(result).toMatchObject({ status: 'delivered', last_update: '2026-09-02T11:38:03.275' });
    expect(result.events?.map((event) => [event.time, event.description, event.stage])).toEqual([
      ['2026-09-02T11:38:03.275', 'Delivered', 'delivered'],
      ['2026-09-02T03:54:29.410465', 'In delivery', 'out_for_delivery'],
      ['2026-09-01T17:21:52.001', 'Transferred', 'in_transit'],
      ['2026-09-01T13:24:52.0503924', 'Recorded', 'registered'],
    ]);
    expect(JSON.stringify(result)).not.toContain('Made Up Recipient');
  });

  it('keeps a milestone per parcel when the parcels reach it at different times', () => {
    const result = parsePlanzerTrackingResponse({
      shipmentNumber: '12345678',
      overallStatus: { text: { english: 'Shipment delivered' } },
      transportPositions: ['2026-09-02T11:38:03', '2026-09-03T09:10:00'].map((createdAt, index) => ({
        positionNumber: `0000000000000000001${index}`,
        positionEvents: [{ createdAt, text: { english: 'Shipped' } }],
      })),
    }, '12345678');
    expect(result.events?.map((event) => event.time)).toEqual(['2026-09-03T09:10:00', '2026-09-02T11:38:03']);
  });

  it('uses only the matching transport position and recognizes the delivered label', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      overallStatus: { text: { english: 'Shipment delivered' } },
      transportPositions: [
        {
          positionNumber: '123456',
          positionEvents: [{
            createdAt: '2026-08-30T12:00:00Z',
            text: { english: 'Shipment delivered' },
          }],
        },
        {
          positionNumber: '999999',
          positionEvents: [{
            createdAt: '2026-08-31T12:00:00Z',
            text: { english: 'Private event from a different shipment' },
          }],
        },
      ],
    }));

    await expect(fetchPlanzer('ref.000123456')).resolves.toMatchObject({
      status: 'delivered',
      last_status_text: 'Shipment delivered',
      events: [{ description: 'Shipment delivered' }],
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/shipments/123456/Pak');
  });

  it('rejects transport positions belonging to another shipment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      overallStatus: { text: { english: 'Shipment on the way' } },
      transportPositions: [{ positionNumber: '999999', positionEvents: [] }],
    }));

    await expect(fetchPlanzer('123456')).rejects.toThrow('different shipment');
  });

  it('rejects a reply for another shipment number', () => {
    expect(() => parsePlanzerTrackingResponse({
      shipmentNumber: '87654321',
      overallStatus: { text: { english: 'Shipment on the way' } },
      transportPositions: [{ positionNumber: '00000000000000000017', positionEvents: [] }],
    }, '12345678')).toThrow('different shipment');
  });

  it('uses the environment fetcher the factory hands the tracker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      overallStatus: { text: { english: 'Recorded' } },
      transportPositions: [{ positionNumber: QUICKPAC_NUMBER, positionEvents: [] }],
    }));
    const global = vi.spyOn(globalThis, 'fetch');

    await expect(new PlanzerTracker({ fetcher }).fetch(QUICKPAC_NUMBER))
      .resolves.toMatchObject({ status: 'pending' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });
});

describe('Planzer milestone labels', () => {
  it.each([
    ['Recorded', 'registered'],
    ['Transferred', 'in_transit'],
    ['Shipment on the way', 'in_transit'],
    ['In delivery', 'out_for_delivery'],
    ['Shipment out for delivery', 'out_for_delivery'],
    ['Delivered', 'delivered'],
    ['Shipment delivered', 'delivered'],
    // Planzer's English "Shipped" means delivered, not dispatched.
    ['Shipped', 'delivered'],
    ['Not delivered', 'failed_attempt'],
    ['Not delivered – A delivery card has been deposited', 'failed_attempt'],
    ['New delivery released', 'in_transit'],
    // Generated localization aliases, matched case-insensitively.
    ['Enregistré', 'registered'],
    ['Erfasst', 'registered'],
    ['Registrato', 'registered'],
    ['Transféré', 'in_transit'],
    ['Weitergeleitet', 'in_transit'],
    ['Inoltrato', 'in_transit'],
    ['En cours de livraison', 'out_for_delivery'],
    ['In Zustellung', 'out_for_delivery'],
    ['In consegna', 'out_for_delivery'],
    ['Livré', 'delivered'],
    ['Zugestellt', 'delivered'],
    ['Consegnato', 'delivered'],
  ] as const)('maps %s to %s', (label, stage) => {
    expect(planzerEventStage(label)).toBe(stage);
  });

  it('stores the mistranslated "Shipped" as "Delivered" and keeps other labels verbatim', () => {
    expect(planzerDescription('Shipped')).toBe('Delivered');
    for (const label of ['Recorded', 'Transferred', 'In delivery', 'Delivered', 'Shipment delivered', 'Zugestellt']) {
      expect(planzerDescription(label)).toBe(label);
    }
    expect(parsePlanzerTrackingResponse({
      overallStatus: { text: { english: 'Shipped' } },
      transportPositions: [{
        positionNumber: QUICKPAC_NUMBER,
        positionEvents: [{ createdAt: '2026-09-01T12:00:00', text: { english: 'Shipped' } }],
      }],
    }, QUICKPAC_NUMBER)).toMatchObject({
      status: 'delivered',
      last_status_text: 'Delivered',
      events: [{ description: 'Delivered', stage: 'delivered' }],
    });
  });

  it('refuses to turn an unfamiliar label into history', () => {
    expect(planzerEventStage('New status with private details')).toBeUndefined();
    expect(() => parsePlanzerTrackingResponse({
      overallStatus: { text: { english: 'Shipment delivered' } },
      transportPositions: [{
        positionNumber: QUICKPAC_NUMBER,
        positionEvents: [{ createdAt: '2026-09-01T12:00:00Z', text: { english: 'New status with private details' } }],
      }],
    }, QUICKPAC_NUMBER)).toThrow('Planzer returned an unrecognized tracking event status');
  });
});

describe('Planzer declared capabilities and privacy', () => {
  const delivered = parsePlanzerTrackingResponse(fixture('delivered.json'), QUICKPAC_NUMBER);
  const checks: Record<string, (result: CarrierResult) => boolean> = {
    history: (result) => (result.events?.length ?? 0) > 0,
    location: (result) => (result.events ?? []).some((event) => Boolean(event.location)),
    eta: (result) => Boolean(result.expected_delivery),
    eta_window: (result) => Boolean(result.expected_delivery_from),
    sender_name: (result) => Boolean(result.sender_name),
    pickup_point: (result) => Boolean(result.pickup_point),
    weight: (result) => result.weight_kg != null,
    dimensions: (result) => Boolean(result.dimensions_text),
    delivered_at: (result) => Boolean(result.delivered_at),
    provider_code: (result) => (result.events ?? []).some((event) => Boolean(event.provider_code)),
  };

  it('keeps the four milestones newest first with their own stages', () => {
    expect(delivered).toMatchObject({
      status: 'delivered',
      last_status_text: 'Shipment delivered',
      last_update: '2026-09-01T14:07:10.258',
      expected_delivery: '2026-09-01',
    });
    // The fixture's "Shipped" is Planzer's English for "Zugestellt".
    expect(delivered.events?.map((event) => [event.description, event.stage])).toEqual([
      ['Delivered', 'delivered'],
      ['In delivery', 'out_for_delivery'],
      ['Transferred', 'in_transit'],
      ['Recorded', 'registered'],
    ]);
  });

  it.each(carrier.capabilities)('declares %s and a fixture proves it', (capability) => {
    const check = checks[capability];
    expect(check, `unknown capability ${capability}`).toBeTypeOf('function');
    expect(check!(delivered)).toBe(true);
  });

  it('drops the recipient, the signature and another shipment\'s history', () => {
    const projected = JSON.stringify(delivered);
    for (const value of [
      'Made Up Recipient',
      'Example Street 1',
      'proof-of-delivery',
      'Private event from a different shipment',
    ]) {
      expect(projected).not.toContain(value);
    }
  });
});
