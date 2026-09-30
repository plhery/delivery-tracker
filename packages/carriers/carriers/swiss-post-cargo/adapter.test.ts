import { readFileSync } from 'node:fs';
import { Settings } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../core/errors';
import {
  normalizeSwissPostCargoTrackingNumber,
  parseSwissPostCargoResponse,
  SwissPostCargoTracker,
  swissPostCargoTrackingUrl,
} from './adapter';
import { statusFor } from './status';

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
) as Record<string, unknown>;
const delivered = () => fixture('delivered');
const deliveredShipment = () => (delivered().Data as Record<string, unknown>[])[0]!;

afterEach(() => {
  vi.restoreAllMocks();
  Settings.defaultZone = 'system';
});

describe('Swiss Post Cargo tracking', () => {
  it('normalizes public barcodes and builds the official result URL', () => {
    expect(normalizeSwissPostCargoTrackingNumber(' 12.34-abc789 ')).toBe('1234ABC789');
    expect(swissPostCargoTrackingUrl('12.34-abc789'))
      .toBe('https://apv.swisspost-cargo.com/public/trackandtrace/1234ABC789');
    expect(() => normalizeSwissPostCargoTrackingNumber('letters-only')).toThrow('barcode or reference');
  });

  it('maps only public history fields and rejects a different barcode', () => {
    expect(parseSwissPostCargoResponse(delivered(), '1234ABC789')).toEqual({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-08-30T12:30:00.777+02:00',
      expected_delivery: null,
      timezone: 'Europe/Zurich',
      events: [
        {
          time: '2026-08-30T12:30:00.777+02:00',
          location: 'Zürich',
          description: 'Delivered',
          stage: 'delivered',
          provider_code: 'DLV',
        },
        {
          time: '2026-08-29T07:15:00.100+02:00',
          location: 'Dintikon',
          description: 'Shipment accepted',
          stage: 'accepted',
          provider_code: 'RFS',
        },
      ],
      tracking_url: 'https://apv.swisspost-cargo.com/public/trackandtrace/1234ABC789',
    });
    expect(() => parseSwissPostCargoResponse({
      ...delivered(),
      Data: [{ ...deliveredShipment(), Identifier: '9876OTHER1' }],
    }, '1234ABC789')).toThrow('different shipment');
    expect(() => parseSwissPostCargoResponse({
      ...delivered(),
      Type: 1,
      Data: [{ ...deliveredShipment(), Identifier: undefined }],
    }, '1234ABC789')).toThrow('no shipment identifier');
    expect(() => parseSwissPostCargoResponse({ ...delivered(), Type: 4 }, '1234ABC789'))
      .toThrow('invalid tracking response type');
    expect(() => parseSwissPostCargoResponse({ Data: delivered().Data }, '1234ABC789'))
      .toThrow('invalid tracking response type');
  });

  it('reads offset-less times on Swiss time in any server zone and keeps sent offsets', () => {
    // Stands in for the server's zone: production runs in UTC, and a machine on
    // Swiss time must not pass for it.
    Settings.defaultZone = 'UTC';
    const scan = (TimeStamp: string, Description: string) => ({ TimeStamp, City: 'Dintikon', Status: 'TRN', Description });
    // One barcode with a winter and a summer scan.
    const result = parseSwissPostCargoResponse({
      Type: 1,
      Data: [{
        Identifier: '1234ABC789',
        History: [
          scan('2026-01-15T09:30:00.1', 'Loaded'),
          scan('2026-08-30T12:30:00.777', 'Unloaded'),
          scan('2026-08-30T11:00:00+01:00', 'Sorted'),
          scan('2026-08-30T08:00:00Z', 'Shipment accepted'),
        ],
      }],
    }, '1234ABC789');
    expect(result.events?.map((event) => event.time)).toEqual([
      '2026-08-30T12:30:00.777+02:00',
      '2026-08-30T11:00:00+01:00',
      '2026-08-30T08:00:00Z',
      '2026-01-15T09:30:00.100+01:00',
    ]);
  });

  it('never retains the consignee or the internal full description', () => {
    const serialized = JSON.stringify(parseSwissPostCargoResponse(delivered(), '1234ABC789'));
    for (const privateValue of ['Private recipient', 'Secret street', 'Private operational detail']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('covers every capability declared in carrier.json', () => {
    const result = parseSwissPostCargoResponse(delivered(), '1234ABC789');
    const capabilities: string[] = (JSON.parse(
      readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
    ) as { capabilities: string[] }).capabilities;
    expect(capabilities).toEqual(['history', 'location', 'provider_code']);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.events?.some((event) => event.provider_code)).toBe(true);
  });

  it('turns the official null-data response into a clean unannounced error', () => {
    expect(() => parseSwissPostCargoResponse({ Data: null }, 'CODEXINVALID20260831'))
      .toThrow(NotFoundError);
    try {
      parseSwissPostCargoResponse({ Data: null }, 'CODEXINVALID20260831');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'NotFoundError',
        status: 404,
        message: 'Swiss Post Cargo could not locate the shipment',
      });
    }
  });

  it('leaves a Type 3 relay of Swiss Post tracking to the Swiss Post adapter', () => {
    const relayed = fixture('relayed-swiss-post');
    expect(() => parseSwissPostCargoResponse(relayed, '99.34.123456.12345678')).toThrow(NotFoundError);
    try {
      parseSwissPostCargoResponse(relayed, '99.34.123456.12345678');
    } catch (error) {
      expect(error).toMatchObject({
        status: 404,
        kind: 'not_found',
        message: 'Swiss Post Cargo only relays Swiss Post tracking for this barcode',
      });
    }
    expect(() => parseSwissPostCargoResponse(relayed, '1234ABC789')).toThrow('different shipment');
  });

  it('classifies negative delivery wording before the delivered substring', () => {
    expect(statusFor('ERR', 'Not delivered')).toEqual({ status: 'exception', stage: 'failed_attempt' });
    expect(parseSwissPostCargoResponse({
      Type: 1,
      Data: [{
        Identifier: '1234ABC789',
        History: [{
          TimeStamp: '2026-08-30T12:30:00+02:00',
          Status: 'ERR',
          Description: 'Not delivered',
        }],
      }],
    }, '1234ABC789')).toMatchObject({
      status: 'exception',
      events: [{ stage: 'failed_attempt' }],
    });
  });

  it('posts the identifier to the anonymous bounded endpoint', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      Type: 1,
      Data: [{
        Identifier: '1234ABC789',
        History: [{
          TimeStamp: '2026-08-30T12:30:00+02:00',
          City: 'Zürich',
          Status: 'DLV',
          Description: 'Delivered',
        }],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(new SwissPostCargoTracker({ timeoutMs: 2_000 }).fetch('1234ABC789'))
      .resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://eosapi.swisspost-cargo.com/api/trackandtrace/public',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ Identifier: '1234ABC789' }),
      }),
    );
  });
});

describe('Swiss Post Cargo customer references', () => {
  // A week after the fixture's current consignment was delivered.
  const NOW = Date.parse('2026-09-01T12:00:00Z');
  const sharedReference = () => fixture('shared-reference');

  it('reads a shared reference as the one consignment it still names', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(sharedReference()), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const result = await new SwissPostCargoTracker({ fetcher, now: () => NOW }).fetch('12345678');

    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Signature captured',
      tracking_url: 'https://apv.swisspost-cargo.com/public/trackandtrace/12345678',
    });
    // Both barcodes of the current consignment; their shared announcement once.
    expect(result.events?.map((event) => [event.provider_code, event.location])).toEqual([
      ['SIG', 'Zürich'], ['POD', 'Zürich'], ['SIG', 'Zürich'], ['POD', 'Zürich'],
      ['SCA', ''], ['SCA', ''], ['RFS', 'Dintikon'], ['RFS', 'Dintikon'],
      ['TOV', ''], ['TOV', ''], ['NTF', ''],
    ]);
    const serialized = JSON.stringify(result);
    for (const excluded of ['Olten', 'Chur', 'Sion', 'Privatdorf', '0999', 'Private operational detail']) {
      expect(serialized).not.toContain(excluded);
    }
  });

  it('refuses the form example once every shipment behind it is older than 60 days', () => {
    expect(() => parseSwissPostCargoResponse(sharedReference(), '12345678', Date.parse('2026-11-30T12:00:00Z')))
      .toThrow(expect.objectContaining({
        name: 'NotFoundError',
        status: 404,
        message: 'Swiss Post Cargo only has older shipments for this reference',
      }));
  });

  it('refuses a reference that names two current consignments', () => {
    const payload = sharedReference();
    (payload.Data as unknown[]).push({
      Identifier: '00312345670000000055',
      History: [
        { TimeStamp: '2026-08-18T06:00:00', Status: 'NTF', Description: 'Shipment data received' },
        { TimeStamp: '2026-08-19T10:00:00', Status: 'POD', Description: 'Delivered', City: 'Bern' },
      ],
    });
    expect(() => parseSwissPostCargoResponse(payload, '12345678', NOW)).toThrow(expect.objectContaining({
      name: 'NotFoundError',
      message: 'Swiss Post Cargo has several shipments for this reference',
    }));
  });
});
