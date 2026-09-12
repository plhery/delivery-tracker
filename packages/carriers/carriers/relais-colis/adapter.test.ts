import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import {
  RelaisColisTracker,
  RelaisColisTrackingError,
  normalizeRelaisColisTrackingNumber,
  parseRelaisColisTrackingHtml,
  relaisColisTrackingUrl,
} from './adapter';
import { classifyRelaisColisStatus, comparableText } from './status';

// Public example displayed by the official Relais Colis tracking form.
const OFFICIAL_EXAMPLE = 'CC200000000401';
const CSRF_TOKEN = 'public-test.csrf-token';

type Step = [string, string];

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
}

const carrier = json('./carrier.json') as { capabilities: readonly string[] };
const timeline = json('./fixtures/returned-timeline.json') as { steps: Step[] };

function responseAt(body: BodyInit | null, init: ResponseInit = {}): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, 'url', { value: relaisColisTrackingUrl() });
  return response;
}

function bootstrapPage(): string {
  return `<!doctype html><html><body>
    <form name="track_package" method="post">
      <input id="track_package_trackingNumber" name="track_package[trackingNumber]">
      <input id="track_package__token" name="track_package[_token]" value="${CSRF_TOKEN}">
    </form>
  </body></html>`;
}

function trackingPage(options: {
  trackingNumber?: string;
  rows?: Step[];
  error?: string;
} = {}): string {
  const trackingNumber = options.trackingNumber ?? OFFICIAL_EXAMPLE;
  const rows = options.rows ?? timeline.steps;
  return `<!doctype html><html><body>
    <form name="track_package" method="post">
      <input id="track_package_trackingNumber" name="track_package[trackingNumber]"
        value="${trackingNumber}">
      ${options.error ? `<div class="error field-error">${options.error}</div>` : ''}
    </form>
    <section class="follow">
      <div class="follow-address-box">
        <p class="follow-address follow-address--bold">PRIVATE RECIPIENT</p>
        <p class="follow-address">10 PRIVATE STREET, 75012 PRIVATE CITY</p>
      </div>
      <ol class="follow-steps">
        ${rows.map(([date, description]) => `
          <li class="follow-step">
            <div class="follow-step-content">
              <div>
                <p class="follow-step-text">${description}</p>
                <p class="follow-step-date">${date}</p>
              </div>
            </div>
          </li>`).join('')}
      </ol>
    </section>
    <script>window.recipient = 'private@example.test';</script>
  </body></html>`;
}

afterEach(() => vi.restoreAllMocks());

describe('Relais Colis tracking input', () => {
  it('accepts the public official example and builds the current tracking URL', () => {
    expect(normalizeRelaisColisTrackingNumber(' cc 2000.0000-0401 ')).toBe(OFFICIAL_EXAMPLE);
    expect(normalizeRelaisColisTrackingNumber('1234567890')).toBe('1234567890');
    const url = new URL(relaisColisTrackingUrl());
    expect(url.origin).toBe('https://www.relaiscolis.com');
    expect(url.pathname).toBe('/colis/suivre');
    expect(url.search).toBe('');
  });

  it('rejects unsupported lengths, non-ASCII input, and parameter injection', () => {
    for (const value of [
      '123456789',
      '12345678901234567',
      'ABCDEFGHIJKL',
      'CC200000000401&admin=true',
      'CC20000000040É',
    ]) {
      expect(() => normalizeRelaisColisTrackingNumber(value)).toThrow('10 to 16');
    }
  });
});

describe('Relais Colis status vocabulary', () => {
  it('compares sentences without case or diacritics and keeps pickup before delivery', () => {
    expect(comparableText("Votre colis est en cours d'acheminement")).toBe('votre colis est en cours d acheminement');
    expect(classifyRelaisColisStatus('Votre colis est disponible dans votre Relais Colis'))
      .toEqual({ status: 'out_for_delivery', stage: 'ready_for_pickup' });
    expect(classifyRelaisColisStatus('Votre colis a été livré au destinataire'))
      .toEqual({ status: 'delivered', stage: 'delivered' });
    expect(classifyRelaisColisStatus('Nouvelle formulation inconnue'))
      .toEqual({ status: 'unknown', stage: 'in_transit' });
  });
});

describe('Relais Colis HTML normalization', () => {
  it('verifies the shipment, sorts history, maps statuses, and excludes address data', () => {
    const result = parseRelaisColisTrackingHtml(trackingPage(), OFFICIAL_EXAMPLE);

    expect(result).toMatchObject({
      status: 'exception',
      last_status_text: 'VOTRE COLIS A ÉTÉ RETOURNÉ À VOTRE VENDEUR',
      last_update: '2026-08-29T14:20:00+02:00',
      expected_delivery: null,
      timezone: 'Europe/Paris',
    });
    expect(result.events).toEqual([
      {
        time: '2026-08-29T14:20:00+02:00',
        location: '',
        description: 'VOTRE COLIS A ÉTÉ RETOURNÉ À VOTRE VENDEUR',
        stage: 'returned',
      },
      {
        time: '2026-08-28T09:15:00+02:00',
        location: '',
        description: 'Votre colis est disponible dans votre Relais Colis',
        stage: 'ready_for_pickup',
      },
      {
        time: '2026-08-27T18:05:00+02:00',
        location: '',
        description: "Votre colis est en cours d'acheminement dans notre réseau",
        stage: 'in_transit',
      },
      {
        time: '2026-08-26T08:30:00+02:00',
        location: '',
        description: 'Votre colis a été pris en charge',
        stage: 'in_transit',
      },
      {
        time: '2026-08-25T16:00:00+02:00',
        location: '',
        description: 'Votre colis a été annoncé',
        stage: 'registered',
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('PRIVATE RECIPIENT');
    expect(serialized).not.toContain('PRIVATE STREET');
    expect(serialized).not.toContain('private@example.test');
  });

  it('produces every capability carrier.json declares', () => {
    const result: CarrierResult = parseRelaisColisTrackingHtml(trackingPage(), OFFICIAL_EXAMPLE);
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

  it('maps delivered, pickup-ready, and out-for-delivery updates without collisions', () => {
    expect(parseRelaisColisTrackingHtml(trackingPage({
      rows: [['29/08/2026 à 15:00', 'Votre colis a été livré au destinataire']],
    }), OFFICIAL_EXAMPLE)).toMatchObject({
      status: 'delivered',
      events: [{ stage: 'delivered' }],
    });

    expect(parseRelaisColisTrackingHtml(trackingPage({
      rows: [['29/08/2026 à 12:00', 'Votre colis est disponible dans votre Relais Colis']],
    }), OFFICIAL_EXAMPLE)).toMatchObject({
      status: 'out_for_delivery',
      events: [{ stage: 'ready_for_pickup' }],
    });

    expect(parseRelaisColisTrackingHtml(trackingPage({
      rows: [['29/08/2026 à 08:00', 'Votre colis est en cours de livraison dans votre Relais Colis']],
    }), OFFICIAL_EXAMPLE)).toMatchObject({
      status: 'out_for_delivery',
      events: [{ stage: 'out_for_delivery' }],
    });
  });

  it('rejects provider errors, mismatched identifiers, and incomplete pages', () => {
    expect(() => parseRelaisColisTrackingHtml(trackingPage({
      rows: [],
      error: 'Aucune donnée de suivi pour votre colis, veuillez réessayer plus tard',
    }), OFFICIAL_EXAMPLE)).toThrow(RelaisColisTrackingError);

    expect(() => parseRelaisColisTrackingHtml(trackingPage({
      trackingNumber: 'CC999999999901',
    }), OFFICIAL_EXAMPLE)).toThrow('different shipment');

    expect(() => parseRelaisColisTrackingHtml(
      '<html><body>Generic home page</body></html>',
      OFFICIAL_EXAMPLE,
    )).toThrow('shipment identifier');

    expect(() => parseRelaisColisTrackingHtml(trackingPage({ rows: [] }), OFFICIAL_EXAMPLE))
      .toThrow(SchemaError);
    expect(() => parseRelaisColisTrackingHtml(trackingPage({ rows: [] }), OFFICIAL_EXAMPLE))
      .toThrow('tracking history');
    expect(() => parseRelaisColisTrackingHtml('   ', OFFICIAL_EXAMPLE))
      .toThrow(IndeterminateError);
  });

  it('keeps the provider-specific not-found name inside the shared taxonomy', () => {
    const error = new RelaisColisTrackingError();
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({
      name: 'RelaisColisTrackingError',
      kind: 'not_found',
      status: 404,
      provider: 'Relais Colis',
      message: 'Relais Colis could not locate the shipment',
    });
  });
});

describe('Relais Colis tracker', () => {
  it('establishes a bounded CSRF session and posts the official form fields', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    fetcher.mockResolvedValueOnce(responseAt(bootstrapPage(), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': 'PHPSESSID=public-test-session; Path=/; Secure; HttpOnly; SameSite=Lax',
      },
    }));
    fetcher.mockResolvedValueOnce(responseAt(trackingPage(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }));

    await expect(new RelaisColisTracker({ timeoutMs: 1_000 }).fetch(OFFICIAL_EXAMPLE)).resolves.toMatchObject({
      status: 'exception',
      tracking_url: relaisColisTrackingUrl(),
      tracking_source: 'rendered-page',
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, bootstrapInit] = fetcher.mock.calls[0]!;
    expect(bootstrapInit).toMatchObject({ cache: 'no-store', redirect: 'manual' });

    const [, postInit] = fetcher.mock.calls[1]!;
    expect(postInit).toMatchObject({
      cache: 'no-store',
      redirect: 'manual',
      method: 'POST',
    });
    const body = new URLSearchParams(String(postInit?.body));
    expect(body.get('track_package[trackingNumber]')).toBe(OFFICIAL_EXAMPLE);
    expect(body.get('track_package[searchPackage]')).toBe('');
    expect(body.get('track_package[_token]')).toBe(CSRF_TOKEN);
    expect(new Headers(postInit?.headers).get('cookie')).toContain('PHPSESSID=public-test-session');
  });

  it('fails closed on missing CSRF tokens, redirects, and provider errors', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    fetcher.mockResolvedValueOnce(new Response('<html>no form</html>'));
    await expect(new RelaisColisTracker().fetch(OFFICIAL_EXAMPLE))
      .rejects.toThrow('CSRF token');

    fetcher.mockResolvedValueOnce(new Response(bootstrapPage()));
    fetcher.mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: 'https://example.test/challenge' },
    }));
    await expect(new RelaisColisTracker().fetch(OFFICIAL_EXAMPLE)).rejects.toMatchObject({
      name: 'RelaisColisTrackingError',
      kind: 'not_found',
      status: 404,
      message: 'Relais Colis could not locate the shipment',
    });

    fetcher.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    await expect(new RelaisColisTracker().fetch(OFFICIAL_EXAMPLE)).rejects.toMatchObject({
      name: 'UpstreamHttpError',
      status: 503,
    });
  });
});
