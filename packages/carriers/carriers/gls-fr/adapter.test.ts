import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchemaError } from '../../core/errors';
import {
  GLSFranceTracker,
  glsFranceTrackingApiUrl,
  glsFranceTrackingUrl,
  normalizeGLSFranceTrackingNumber,
  parseGLSFranceTrackingResponse,
} from './adapter';
import { glsFranceStatus } from './status';

const TRACKING_NUMBER = '00AB12CD';
const NUMERIC_TRACKING_NUMBER = '36631000001';
const CAPABILITIES: readonly string[] = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'carrier.json'), 'utf8'),
).capabilities;

interface Fixture {
  colis: Record<string, unknown>;
  adresse: Record<string, unknown>;
  evenements: Record<string, unknown>[];
}

function deliveredFixture(): Fixture {
  return JSON.parse(readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'delivered.json'),
    'utf8',
  )) as Fixture;
}

afterEach(() => vi.restoreAllMocks());

describe('GLS France tracking input', () => {
  it('normalizes official identifiers and builds public URLs', () => {
    expect(normalizeGLSFranceTrackingNumber('00ab-12.cd')).toBe(TRACKING_NUMBER);
    expect(normalizeGLSFranceTrackingNumber('36631 000-001')).toBe(NUMERIC_TRACKING_NUMBER);

    expect(glsFranceTrackingUrl(TRACKING_NUMBER))
      .toBe(`https://moncolis.gls-france.com/fr/${TRACKING_NUMBER}`);
    expect(glsFranceTrackingApiUrl(NUMERIC_TRACKING_NUMBER)).toBe(
      `https://public.infra-prod.prod.cloud.fr.gls-group.com/consignee-ws/api/v1/command/public/codes/${NUMERIC_TRACKING_NUMBER}`,
    );
  });

  it('rejects unsupported or unsafe identifiers', () => {
    for (const value of [
      'ABC1234',
      'ABC123456',
      '3663100000A',
      '00AB12/CD',
      '00AB12CÉ',
      '00AB12CD?admin=true',
    ]) {
      expect(() => normalizeGLSFranceTrackingNumber(value)).toThrow('8 letters or digits, or 11 digits');
    }
  });
});

describe('GLS France status mapping', () => {
  it.each([
    [['CON'], 'pending'],
    [['REC', 'EXP', 'PBC', 'DOU', 'DEL'], 'in_transit'],
    [['TRV'], 'out_for_delivery'],
    [['LIV', 'LTV', 'LTL', 'LIL', 'LIT', 'LTT'], 'delivered'],
    [['INC', 'PBP', 'NLI', 'NLK', 'NLP', 'RET', 'PBA', 'SIN'], 'exception'],
    [['LIP', 'LTP', 'LIK', 'LTK', 'PAQ'], 'out_for_delivery'],
  ] as const)('maps %j to %s', (codes, expected) => {
    for (const code of codes) expect(glsFranceStatus(code)).toBe(expected);
  });

  it('does not guess an unknown provider code', () => {
    expect(glsFranceStatus('NEW')).toBe('unknown');
    expect(glsFranceStatus({ code: 'LIV' })).toBe('unknown');
  });

  it('leaves an unmapped code without a stage so the sync can classify it', () => {
    const fixture = deliveredFixture();
    fixture.colis.statutColis = 'NEW';
    fixture.evenements = [{
      datereference: '2026-08-29 11:42:00.0',
      statutEvenement: 'NEW',
      typeEvenement: 'NEW',
      codelieuEvenement: 'FR0012',
    }];

    const result = parseGLSFranceTrackingResponse(fixture, TRACKING_NUMBER);
    expect(result.status).toBe('unknown');
    expect(result.events?.[0]).toEqual({
      time: '2026-08-29T11:42:00+02:00',
      location: 'FR0012',
      description: 'GLS France tracking update',
      provider_code: 'NEW',
    });
  });
});

describe('GLS France response normalization', () => {
  it('sorts and normalizes safe events without retaining recipient or address data', () => {
    const result = parseGLSFranceTrackingResponse(deliveredFixture(), TRACKING_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-08-29T11:42:00+02:00',
      expected_delivery: '2026-08-29',
      timezone: 'Europe/Paris',
    });
    expect(result.events).toEqual([{
      time: '2026-08-29T11:42:00+02:00',
      location: 'FR0012',
      description: 'Delivered',
      stage: 'delivered',
      provider_code: 'LIV',
    }, {
      time: '2026-08-28T08:10:00+02:00',
      location: 'FR9900',
      description: 'Shipment information received',
      stage: 'registered',
      provider_code: 'CON',
    }]);
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'Private Recipient',
      'Private delivery instruction',
      'Private Company',
      'Private Street',
      'private@example.test',
      'private address code',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('returns every capability declared in carrier.json', () => {
    const result = parseGLSFranceTrackingResponse(deliveredFixture(), TRACKING_NUMBER);
    const checks: Record<string, () => boolean> = {
      history: () => (result.events?.length ?? 0) > 0,
      location: () => (result.events ?? []).some((event) => Boolean(event.location)),
      eta: () => result.expected_delivery != null,
      provider_code: () => (result.events ?? []).some((event) => Boolean(event.provider_code)),
    };
    expect(CAPABILITIES.length).toBeGreaterThan(0);
    for (const capability of CAPABILITIES) {
      expect(checks[capability], `no check for capability ${capability}`).toBeDefined();
      expect(checks[capability]!(), `capability ${capability} is declared but never returned`).toBe(true);
    }
  });

  it('accepts the matching numeric identifier and maps pickup readiness', () => {
    const fixture = deliveredFixture();
    fixture.colis.trackid = '00EF34GH';
    fixture.colis.numeroalphaColis = Number(NUMERIC_TRACKING_NUMBER);
    fixture.colis.statutColis = 'LIK';
    fixture.evenements = [{
      datereference: '2026-08-29 09:15:00.0',
      statutEvenement: 'LIK',
      typeEvenement: 'INF',
      codelieuEvenement: 'FR0042',
      nomSignataire: '',
      referenceDestinataire: '',
    }];

    expect(parseGLSFranceTrackingResponse(fixture, NUMERIC_TRACKING_NUMBER)).toMatchObject({
      status: 'out_for_delivery',
      last_status_text: 'Ready for pickup at GLS Locker',
      events: [{ stage: 'ready_for_pickup', provider_code: 'LIK' }],
    });
  });

  it('treats DEL as scheduled unless the latest provider event is a failed LIV attempt', () => {
    const scheduled = deliveredFixture();
    scheduled.colis.statutColis = 'DEL';
    scheduled.evenements = [{
      datereference: '2026-08-29 11:42:00.0',
      statutEvenement: 'DEL',
      typeEvenement: 'EXP',
      codelieuEvenement: 'FR0012',
      nomSignataire: '',
      referenceDestinataire: '',
    }];

    expect(parseGLSFranceTrackingResponse(scheduled, TRACKING_NUMBER)).toMatchObject({
      status: 'in_transit',
      last_status_text: 'Delivery delayed',
      events: [{
        description: 'Delivery delayed',
        stage: 'in_transit',
        provider_code: 'DEL',
      }],
    });

    const failed = deliveredFixture();
    failed.colis.statutColis = 'DEL';
    failed.evenements = [{
      datereference: '2026-08-29 11:42:00.0',
      statutEvenement: 'DEL',
      typeEvenement: 'LIV',
      codelieuEvenement: 'FR0012',
      nomSignataire: '',
      referenceDestinataire: '',
    }];

    expect(parseGLSFranceTrackingResponse(failed, TRACKING_NUMBER)).toMatchObject({
      status: 'exception',
      last_status_text: 'Delivery delayed',
      events: [{
        description: 'Delivery delayed',
        stage: 'failed_attempt',
        provider_code: 'DEL',
      }],
    });

    failed.colis.statutColis = 'NEW';
    expect(parseGLSFranceTrackingResponse(failed, TRACKING_NUMBER))
      .toMatchObject({ status: 'exception' });
  });

  it('rejects malformed responses and responses for another shipment', () => {
    expect(() => parseGLSFranceTrackingResponse([], TRACKING_NUMBER))
      .toThrow(SchemaError);
    expect(() => parseGLSFranceTrackingResponse([], TRACKING_NUMBER))
      .toThrow('invalid tracking response');
    expect(() => parseGLSFranceTrackingResponse({ colis: { statutColis: 'CON' } }, TRACKING_NUMBER))
      .toThrow('did not return a shipment identifier');

    const fixture = deliveredFixture();
    fixture.colis.trackid = '00EF34GH';
    expect(() => parseGLSFranceTrackingResponse(fixture, TRACKING_NUMBER))
      .toThrow('different shipment');
  });

  it('fetches and parses the bounded public JSON endpoint', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify(deliveredFixture()),
      { headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(new GLSFranceTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [requested, init] = fetcher.mock.calls[0]!;
    expect(String(requested)).toBe(glsFranceTrackingApiUrl(TRACKING_NUMBER));
    expect(init).toMatchObject({
      cache: 'no-store',
      redirect: 'error',
      headers: expect.objectContaining({
        Accept: 'application/json',
        Origin: 'https://moncolis.gls-france.com',
      }),
    });
  });

  it('preserves the official wrong-number 404 for a validly shaped parcel number', async () => {
    const wrongNumber = '00ZZ00Z0';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      `404 No command found for code: ${wrongNumber}`,
      { status: 404 },
    ));

    await expect(new GLSFranceTracker({ timeoutMs: 1_000 }).fetch(wrongNumber)).rejects.toMatchObject({
      name: 'UpstreamHttpError',
      provider: 'GLS France tracking',
      kind: 'not_found',
      status: 404,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toBe(glsFranceTrackingApiUrl(wrongNumber));
  });

  it('enforces the adapter response-size limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      headers: { 'Content-Length': '750001' },
    }));

    await expect(new GLSFranceTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toThrow('unexpectedly large response');
  });
});
