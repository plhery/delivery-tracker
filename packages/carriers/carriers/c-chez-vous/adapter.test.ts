import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, SchemaError } from '../../core/errors';
import {
  CChezVousTracker,
  cChezVousTrackingUrl,
  normalizeCChezVousCredential,
  parseCChezVousTrackingHtml,
} from './adapter';
import { parcelStep, stepDetails } from './status';

const here = path.dirname(fileURLToPath(import.meta.url));
// C Chez Vous publishes this identifier as an example on its official tracking
// page: https://www.cchezvous.fr/suivi-colis. The fixture below is a fully
// synthetic provider-shaped record; no customer shipment data is retained.
const OFFICIAL_EXAMPLE_NUMBER = 'FGRC45BKLM';
const CAPABILITIES: readonly string[] = JSON.parse(
  readFileSync(path.join(here, 'carrier.json'), 'utf8'),
).capabilities;
const PRIVATE_PLACEHOLDERS = [
  'PRIVATE SHOP',
  'PRIVATE INTERNAL PARCEL',
  'private@example.test',
  'PRIVATE PHONE',
  'PRIVATE RECIPIENT',
  'PRIVATE STREET',
  'PRIVATE ARTICLE',
  'PRIVATE DEALER ADDRESS',
];

function trackingPage(overrides: Record<string, unknown> = {}): string {
  const base = JSON.parse(
    readFileSync(path.join(here, 'fixtures', 'out-for-delivery.json'), 'utf8'),
  ) as Record<string, unknown>;
  const payload = { ...base, ...overrides };
  const encoded = JSON.stringify(payload).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `<!doctype html><html><body>
    <h1>Votre commande : <span class="title--tertiary">${String(payload.package_number)}</span></h1>
    <tracking :tracking-results="${encoded}"></tracking>
  </body></html>`;
}

afterEach(() => vi.restoreAllMocks());

describe('C Chez Vous combined tracking credential', () => {
  it('accepts order IDs and restores the official --postcode composite form', () => {
    expect(normalizeCChezVousCredential(` ${OFFICIAL_EXAMPLE_NUMBER.toLowerCase()} `))
      .toBe(OFFICIAL_EXAMPLE_NUMBER);
    expect(normalizeCChezVousCredential('4TZKO156790--59600')).toBe('4TZKO156790--59600');
    // The shared package normalizer removes punctuation before carrier dispatch.
    expect(normalizeCChezVousCredential('4TZKO15679059600')).toBe('4TZKO156790--59600');

    for (const value of [
      'SHORT',
      'ABCDEFGHIJ',
      'FGRC45BKLM--59600',
      '4TZKO156790--96000',
      '4TZKO156790--ABCDE',
      '4TZKO156790--5960',
      'FGRC45BKLM?admin=true',
      'FGRC45BKLÉ',
    ]) expect(() => normalizeCChezVousCredential(value)).toThrow();
  });

  it('builds the official path without allowing path or query injection', () => {
    expect(cChezVousTrackingUrl(OFFICIAL_EXAMPLE_NUMBER))
      .toBe(`https://www.cchezvous.fr/suivi-colis/${OFFICIAL_EXAMPLE_NUMBER}`);
    expect(cChezVousTrackingUrl('4TZKO15679059600'))
      .toBe('https://www.cchezvous.fr/suivi-colis/4TZKO156790--59600');
  });
});

describe('C Chez Vous step map', () => {
  it('reads the five documented steps and nothing else', () => {
    expect(stepDetails(parcelStep(5))).toMatchObject({ stage: 'delivered' });
    expect(stepDetails(parcelStep(1))).toMatchObject({ stage: 'registered' });
    for (const value of [0, 6, 4.5, '4', null]) {
      expect(stepDetails(parcelStep(value))).toBeNull();
    }
  });
});

describe('C Chez Vous response normalization', () => {
  it('parses a provider-shaped fixture and excludes all recipient and merchant fields', () => {
    const result = parseCChezVousTrackingHtml(trackingPage(), OFFICIAL_EXAMPLE_NUMBER);

    expect(result).toEqual({
      status: 'out_for_delivery',
      current_stage: 'out_for_delivery',
      last_status_text: 'Commande en livraison',
      last_update: null,
      expected_delivery: '2024-01-02',
      timezone: 'Europe/Paris',
      events: [{ description: 'Commande en livraison', stage: 'out_for_delivery' }],
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of PRIVATE_PLACEHOLDERS) {
      expect(serialized).not.toContain(privateValue);
    }
    // The appointment window is shown to the recipient but deliberately not kept.
    expect(serialized).not.toContain('08h00');
  });

  it('returns every capability declared in carrier.json', () => {
    const result = parseCChezVousTrackingHtml(trackingPage(), OFFICIAL_EXAMPLE_NUMBER);
    const checks: Record<string, () => boolean> = {
      eta: () => result.expected_delivery != null,
    };
    expect(CAPABILITIES.length).toBeGreaterThan(0);
    for (const capability of CAPABILITIES) {
      expect(checks[capability], `no check for capability ${capability}`).toBeDefined();
      expect(checks[capability]!(), `capability ${capability} is declared but never returned`).toBe(true);
    }
  });

  it('uses the least-advanced parcel and does not retain a fulfilled expected date', () => {
    const result = parseCChezVousTrackingHtml(trackingPage({
      parcels: [
        { parcelStep: 5, date: '2024-01-02T07:00:00Z' },
        { parcelStep: 3, date: '2024-01-03T07:00:00Z' },
      ],
    }), OFFICIAL_EXAMPLE_NUMBER);
    expect(result).toMatchObject({
      status: 'in_transit',
      expected_delivery: '2024-01-03',
      events: [{ stage: 'in_transit' }],
    });

    const delivered = parseCChezVousTrackingHtml(trackingPage({
      parcels: [{ parcelStep: 5, date: '2024-01-02T07:00:00Z' }],
    }), OFFICIAL_EXAMPLE_NUMBER);
    expect(delivered).toMatchObject({ status: 'delivered', expected_delivery: null });
  });

  it('reports an order with an unknown step without a stage', () => {
    const result = parseCChezVousTrackingHtml(trackingPage({
      parcels: [
        { parcelStep: 4, date: '2024-01-02T07:00:00Z' },
        { parcelStep: 6, date: '2024-01-03T07:00:00Z' },
      ],
    }), OFFICIAL_EXAMPLE_NUMBER);
    expect(result).toMatchObject({
      status: 'unknown',
      last_status_text: 'Suivi C Chez Vous',
      events: [{ description: 'Suivi C Chez Vous' }],
    });
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0]?.stage).toBeUndefined();
  });

  it('rejects mismatched, not-found, and malformed pages', () => {
    expect(() => parseCChezVousTrackingHtml(
      trackingPage({ package_number: 'ZZZZZZZZZ0' }),
      OFFICIAL_EXAMPLE_NUMBER,
    )).toThrow(SchemaError);
    expect(() => parseCChezVousTrackingHtml(
      trackingPage({ package_number: 'ZZZZZZZZZ0' }),
      OFFICIAL_EXAMPLE_NUMBER,
    )).toThrow('different shipment');
    expect(() => parseCChezVousTrackingHtml(
      '<div class="alert">La commande est introuvable</div>',
      OFFICIAL_EXAMPLE_NUMBER,
    )).toThrow(NotFoundError);
    expect(() => parseCChezVousTrackingHtml(
      '<html><body>Generic tracking page</body></html>',
      OFFICIAL_EXAMPLE_NUMBER,
    )).toThrow('did not return tracking details');
  });
});

describe('C Chez Vous tracker', () => {
  it('uses a bounded direct request and parses a matching page', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(trackingPage()));

    await expect(new CChezVousTracker({ timeoutMs: 1_000 }).fetch(OFFICIAL_EXAMPLE_NUMBER))
      .resolves.toMatchObject({ status: 'out_for_delivery' });
    expect(fetcher.mock.calls[0]?.[0]).toBe(cChezVousTrackingUrl(OFFICIAL_EXAMPLE_NUMBER));
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
      redirect: 'manual',
    });
  });

  it('maps the official wrong-number redirect and a 404 to a clean not-found error', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    fetcher.mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: '/suivi-colis' },
    }));
    await expect(new CChezVousTracker().fetch('ZZZZZZZZZ0')).rejects.toMatchObject({
      name: 'NotFoundError',
      provider: 'C Chez Vous',
      message: 'C Chez Vous could not locate the shipment',
      kind: 'not_found',
      status: 404,
    });

    fetcher.mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    await expect(new CChezVousTracker().fetch('ZZZZZZZZZ0'))
      .rejects.toMatchObject({ status: 404 });
  });
});
