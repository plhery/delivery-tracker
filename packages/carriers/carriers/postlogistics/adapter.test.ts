import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CarrierResult } from '../../core/result';
import {
  fetchPostlogistics,
  parsePostlogisticsTrackingResponse,
  PostlogisticsTracker,
} from './adapter';
import { postlogisticsStatus } from './status';

const folder = path.dirname(fileURLToPath(import.meta.url));
const carrier = JSON.parse(
  readFileSync(path.join(folder, 'carrier.json'), 'utf8'),
) as { capabilities: string[] };

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(folder, 'fixtures', name), 'utf8'));
}

const POSTLOGISTICS_WRONG_NUMBER = '000000000000000000';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('PostLogistics wrong-number handling', () => {
  it('maps a null Data answer to a privacy-safe 404', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      Data: null,
      privateMessage: 'Private upstream details',
    }));

    try {
      await fetchPostlogistics(POSTLOGISTICS_WRONG_NUMBER);
      throw new Error('Expected the lookup to fail');
    } catch (error) {
      expect(error).toMatchObject({ name: 'NotFoundError', status: 404, kind: 'not_found' });
      expect(String(error)).toContain('PostLogistics could not locate the shipment');
      expect(String(error)).not.toContain('Private upstream details');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      Identifier: POSTLOGISTICS_WRONG_NUMBER,
    });
  });

  it('rejects a Type 1 answer describing a different shipment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      Type: 1,
      Data: [{ Identifier: '999999999999999999', History: [] }],
    }));

    await expect(fetchPostlogistics(POSTLOGISTICS_WRONG_NUMBER))
      .rejects.toThrow('different shipment');
  });

  it('uses the environment fetcher the factory hands the tracker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      Type: 1,
      Data: [{ Identifier: POSTLOGISTICS_WRONG_NUMBER, History: [] }],
    }));
    const global = vi.spyOn(globalThis, 'fetch');

    await expect(new PostlogisticsTracker({ fetcher }).fetch(POSTLOGISTICS_WRONG_NUMBER))
      .resolves.toMatchObject({ events: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });
});

describe('PostLogistics response types and event ordering', () => {
  it('matches and filters barcode lookups with Type 1', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      Type: 1,
      Data: [
        {
          Identifier: ' 00-123.456 ',
          History: [{
            TimeStamp: '2026-08-30T09:00:00Z',
            Status: 'TRN',
            Description: 'Matching shipment in transit',
          }],
        },
        {
          Identifier: '999999',
          History: [{
            TimeStamp: '2026-08-31T09:00:00Z',
            Status: 'DLV',
            Description: 'Different shipment delivered',
          }],
        },
      ],
    }));

    await expect(fetchPostlogistics('00123456')).resolves.toMatchObject({
      status: 'in_transit',
      last_status_text: 'Matching shipment in transit',
      events: [{ description: 'Matching shipment in transit' }],
    });
  });

  it('allows Type 2 references to resolve returned barcodes and selects the latest instant', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      Type: 2,
      Data: [
        {
          Identifier: 'RETURNED-BARCODE-1',
          History: [{
            TimeStamp: '2026-08-31T00:00:00+02:00',
            Status: 'TRN',
            Description: 'Earlier by absolute time',
          }],
        },
        {
          Identifier: 'RETURNED-BARCODE-2',
          History: [{
            TimeStamp: '2026-08-30T23:30:00-02:00',
            Status: 'DLV',
            Description: 'Latest by absolute time',
          }],
        },
      ],
    }));

    await expect(fetchPostlogistics('CUSTOMER-REFERENCE')).resolves.toMatchObject({
      status: 'delivered',
      last_status_text: 'Latest by absolute time',
      last_update: '2026-08-30T23:30:00-02:00',
      events: [
        { description: 'Latest by absolute time' },
        { description: 'Earlier by absolute time' },
      ],
    });
  });

  it('rejects an unsupported response type and a mismatched Type 1 barcode', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        Type: 3,
        Data: [{ Identifier: POSTLOGISTICS_WRONG_NUMBER, History: [] }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        Type: 1,
        Data: [{ Identifier: '999999999999999999', History: [] }],
      }));

    await expect(fetchPostlogistics(POSTLOGISTICS_WRONG_NUMBER))
      .rejects.toThrow('invalid tracking response type');
    await expect(fetchPostlogistics(POSTLOGISTICS_WRONG_NUMBER))
      .rejects.toThrow('different shipment');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not accept a Type 2 response without a resolved barcode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      Type: 2,
      Data: [{ History: [{ Status: 'DLV', Description: 'Private shipment' }] }],
    }));

    await expect(fetchPostlogistics('CUSTOMER-REFERENCE'))
      .rejects.toThrow('did not return a shipment identifier');
  });
});

describe('PostLogistics history codes', () => {
  it.each([
    ['DEL', 'delivered'],
    ['DLV', 'delivered'],
    ['POD', 'delivered'],
    ['SIG', 'delivered'],
    ['NTF', 'pending'],
    // Anything else leaves the shipment moving; the wording is classified by
    // the sync rather than guessed at here.
    ['TRN', 'in_transit'],
    ['', 'in_transit'],
  ] as const)('maps %s to %s', (code, status) => {
    expect(postlogisticsStatus(code)).toBe(status);
  });
});

describe('PostLogistics declared capabilities and privacy', () => {
  const delivered = parsePostlogisticsTrackingResponse(fixture('delivered.json'), '998811223344556677');
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

  it('keeps the scans newest first with their operational city', () => {
    expect(delivered).toMatchObject({
      status: 'delivered',
      last_status_text: 'Shipment delivered',
      last_update: '2026-09-02T09:41:00+02:00',
      expected_delivery: '2026-09-02',
    });
    expect(delivered.events?.map((event) => [event.description, event.location])).toEqual([
      ['Shipment delivered', 'Zurich'],
      ['Shipment in transit', 'Zurich'],
      ['Shipment announced', 'Haerkingen'],
    ]);
  });

  it.each(carrier.capabilities)('declares %s and a fixture proves it', (capability) => {
    const check = checks[capability];
    expect(check, `unknown capability ${capability}`).toBeTypeOf('function');
    expect(check!(delivered)).toBe(true);
  });

  it('drops the recipient and the signature', () => {
    const projected = JSON.stringify(delivered);
    for (const value of ['Made Up Recipient', 'Example Street 1', 'proof-of-delivery']) {
      expect(projected).not.toContain(value);
    }
  });
});
