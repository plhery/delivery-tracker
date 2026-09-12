import { readFileSync } from 'node:fs';
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

afterEach(() => vi.restoreAllMocks());

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
      last_update: '2026-08-30T12:30:00+02:00',
      expected_delivery: null,
      timezone: 'Europe/Zurich',
      events: [
        {
          time: '2026-08-30T12:30:00+02:00',
          location: 'Zürich',
          description: 'Delivered',
          stage: 'delivered',
          provider_code: 'DLV',
        },
        {
          time: '2026-08-29T07:15:00+02:00',
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
    expect(() => parseSwissPostCargoResponse({ ...delivered(), Type: 3 }, '1234ABC789'))
      .toThrow('invalid tracking response type');
    expect(() => parseSwissPostCargoResponse({ Data: delivered().Data }, '1234ABC789'))
      .toThrow('invalid tracking response type');
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
