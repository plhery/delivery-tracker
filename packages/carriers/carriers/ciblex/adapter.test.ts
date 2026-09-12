import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import {
  CiblexTracker,
  ciblexTrackingUrl,
  normalizeCiblexTrackingNumber,
  parseCiblexTrackingHtml,
} from './adapter';
import { classifyCiblexStatus, comparableText } from './status';

// Fully synthetic identifier paired with a deterministic provider-shaped HTML
// fixture. Ciblex does not publish a reusable demo shipment number.
const TEST_TRACKING_NUMBER = '12345678901234';

type Row = [string, string, string, string];

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
}

const carrier = json('./carrier.json') as { capabilities: readonly string[] };
const timeline = json('./fixtures/delivered-timeline.json') as { rows: Row[]; pickupRows: Row[] };

function trackingPage(options: {
  trackingNumber?: string;
  rows?: Row[];
  privateDetail?: string;
} = {}): string {
  const trackingNumber = options.trackingNumber ?? TEST_TRACKING_NUMBER;
  const rows = options.rows ?? timeline.rows;
  return `<!doctype html><html><body>
    <table class="t_bandeau_detail"><tr><td>&nbsp;SUIVI COLIS : ${trackingNumber}</td></tr></table>
    <table class="private"><tr><td>${options.privateDetail ?? 'PRIVATE CUSTOMER AND ORDER'}</td></tr></table>
    <table border="2" bgcolor="#205AA7" cellpadding="2" cellspacing="2">
      <tr class="t_liste_titre">
        <td>&nbsp;Date&nbsp;</td><td>&nbsp;Heure livraison&nbsp;</td>
        <td>&nbsp;Action&nbsp;</td><td>&nbsp;Lieu&nbsp;</td>
      </tr>
      ${rows.map(([date, time, action, location]) => `<tr class="t_liste_ligne">
        <td>${date}</td><td>${time}</td><td>${action}</td><td>${location}</td>
      </tr>`).join('')}
    </table>
    <script>window.privateEmail = 'private@example.test';</script>
  </body></html>`;
}

function emptyTrackingPage(trackingNumber = TEST_TRACKING_NUMBER): string {
  return trackingPage({ trackingNumber, rows: [] });
}

afterEach(() => vi.restoreAllMocks());

describe('Ciblex anonymous tracking input', () => {
  it('accepts fourteen-digit Ciblex barcodes and builds the official URL', () => {
    expect(normalizeCiblexTrackingNumber('12 3456 7890 1234')).toBe(TEST_TRACKING_NUMBER);
    const url = new URL(ciblexTrackingUrl(TEST_TRACKING_NUMBER));
    expect(url.origin).toBe('https://secure.extranet.ciblex.fr');
    expect(url.pathname).toBe('/extranet/client/corps.php');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      module: 'colis',
      colis: TEST_TRACKING_NUMBER,
    });
  });

  it('rejects unsupported lengths, non-ASCII input, and parameter injection', () => {
    for (const value of [
      '1234567890123',
      '123456789012345',
      '1234567890123A',
      '1234567890123É',
      '12345678901234&module=admin',
    ]) expect(() => normalizeCiblexTrackingNumber(value)).toThrow('exactly 14 digits');
  });
});

describe('Ciblex status vocabulary', () => {
  it('compares wording without case or diacritics and leaves new wording unmapped', () => {
    expect(comparableText('COLIS LIVRÉ')).toBe('colis livre');
    expect(classifyCiblexStatus('Colis Livré')).toMatchObject({ stage: 'delivered' });
    expect(classifyCiblexStatus('COLIS LIVRE')).toMatchObject({ stage: 'delivered' });
    expect(classifyCiblexStatus('Statut provider nouveau')).toMatchObject({
      status: 'unknown',
      stage: 'in_transit',
      description: 'Ciblex tracking update',
    });
  });
});

describe('Ciblex response normalization', () => {
  it('normalizes a provider-shaped history without retaining unrelated or unsafe fields', () => {
    const result = parseCiblexTrackingHtml(trackingPage(), TEST_TRACKING_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2021-12-30T05:29:00+01:00',
      expected_delivery: null,
      timezone: 'Europe/Paris',
    });
    expect(result.events).toEqual([{
      time: '2021-12-30T05:29:00+01:00',
      location: '',
      description: 'Delivered',
      stage: 'delivered',
    }, {
      time: '2021-12-30T05:24:00+01:00',
      location: 'Sausheim 68 (68)',
      description: 'Out for delivery',
      stage: 'out_for_delivery',
    }, {
      time: '2021-12-30T05:24:00+01:00',
      location: 'Sausheim 68 (68)',
      description: 'Parcel processed at Ciblex facility',
      stage: 'in_transit',
    }, {
      time: '2021-12-28T09:27:00+01:00',
      location: '',
      description: 'Shipment exception',
      stage: 'exception',
    }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('PRIVATE CUSTOMER AND ORDER');
    expect(serialized).not.toContain('private@example.test');
    expect(serialized).not.toContain('PRIVATE STREET');
  });

  it('produces every capability carrier.json declares', () => {
    const result: CarrierResult = parseCiblexTrackingHtml(trackingPage(), TEST_TRACKING_NUMBER);
    const events = result.events ?? [];
    const produced = new Set([
      ...(events.length > 0 ? ['history'] : []),
      ...(events.some((event) => event.location) ? ['location'] : []),
      ...(events.some((event) => event.provider_code) ? ['provider_code'] : []),
      ...(result.expected_delivery ? ['eta'] : []),
      ...(result.expected_delivery_from ? ['eta_window'] : []),
      ...(result.sender_name ? ['sender_name'] : []),
      ...(result.pickup_point ? ['pickup_point'] : []),
      ...(result.weight_kg != null ? ['weight'] : []),
      ...(result.dimensions_text ? ['dimensions'] : []),
      ...(result.delivered_at ? ['delivered_at'] : []),
    ]);
    expect(carrier.capabilities.length).toBeGreaterThan(0);
    for (const capability of carrier.capabilities) expect([...produced]).toContain(capability);
  });

  it('maps pickup, returned, unknown, and accepted events to safe descriptions', () => {
    const result = parseCiblexTrackingHtml(
      trackingPage({ rows: timeline.pickupRows }),
      TEST_TRACKING_NUMBER,
    );
    expect(result).toMatchObject({
      status: 'exception',
      events: [
        { description: 'Returned to sender', stage: 'returned' },
        { description: 'Ready for pickup', stage: 'ready_for_pickup' },
        { description: 'Shipment collected', stage: 'accepted' },
        { description: 'Ciblex tracking update', stage: 'in_transit' },
      ],
    });
  });

  it('separates the echoed empty table from a bare empty response', () => {
    let error: unknown;
    try {
      parseCiblexTrackingHtml(emptyTrackingPage(), TEST_TRACKING_NUMBER);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({
      kind: 'not_found',
      status: 404,
      provider: 'Ciblex',
      message: 'Ciblex could not locate the shipment',
    });

    let empty: unknown;
    try {
      parseCiblexTrackingHtml('', TEST_TRACKING_NUMBER);
    } catch (caught) {
      empty = caught;
    }
    expect(empty).toBeInstanceOf(IndeterminateError);
    expect(empty).toMatchObject({
      kind: 'indeterminate',
      status: 502,
      message: 'Ciblex returned an empty tracking response',
    });
  });

  it('rejects mismatched and malformed provider pages', () => {
    expect(() => parseCiblexTrackingHtml(
      trackingPage({ trackingNumber: '99999999999999' }),
      TEST_TRACKING_NUMBER,
    )).toThrow(SchemaError);
    expect(() => parseCiblexTrackingHtml(
      trackingPage({ trackingNumber: '99999999999999' }),
      TEST_TRACKING_NUMBER,
    )).toThrow('different shipment');
    expect(() => parseCiblexTrackingHtml('<html>generic page</html>', TEST_TRACKING_NUMBER))
      .toThrow('shipment identifier');
    expect(() => parseCiblexTrackingHtml(
      '<html><p class="f_erreur">CODE BORDEREAU OBLIGATOIRE !</p></html>',
      TEST_TRACKING_NUMBER,
    )).toThrow(NotFoundError);
  });
});

describe('Ciblex tracker', () => {
  it('fetches and parses the bounded anonymous official page', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      trackingPage(),
      { headers: { 'Content-Type': 'text/html; charset=UTF-8' } },
    ));

    await expect(new CiblexTracker({ timeoutMs: 1_000 }).fetch(TEST_TRACKING_NUMBER))
      .resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(ciblexTrackingUrl(TEST_TRACKING_NUMBER));
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Referer'))
      .toBe('https://ciblex.eu/suivi-colis-express/');
  });

  it('recognizes the live wrong-number shape even though Ciblex returns HTTP 200', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(emptyTrackingPage('12345678901234')));
    await expect(new CiblexTracker({ timeoutMs: 1_000 }).fetch('12345678901234')).rejects.toMatchObject({
      name: 'NotFoundError',
      kind: 'not_found',
      status: 404,
      message: 'Ciblex could not locate the shipment',
    });

    fetcher.mockResolvedValueOnce(new Response(''));
    await expect(new CiblexTracker({ timeoutMs: 1_000 }).fetch('12345678901234'))
      .rejects.toThrow('empty tracking response');
  });
});
