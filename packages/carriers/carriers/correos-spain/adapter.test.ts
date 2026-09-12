import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, SchemaError } from '../../core/errors';
import {
  normalizeCorreosSpainTrackingNumber,
  correosSpainTrackingUrl,
  parseCorreosSpainTrackingResponse,
  CorreosSpainTracker,
} from './adapter';
import { classifyCorreosSpainStatus } from './status';

// All identifiers and timestamps below are synthetic. Event codes and Spanish
// wordings reuse the vendor's fixed texts confirmed against a real parcel by
// the prior-art client, so classification exercises production prose rather
// than paraphrases.
const TRACKING_NUMBER = 'PR123456789012345C';
const DELIVERED = JSON.parse(
  readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

function event(code: string, fecha: string, horEvento: string, resumen: string) {
  return { codEvento: code, fecEvento: fecha, horEvento, desTextoResumen: resumen, desTextoAmpliado: resumen };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return { ...structuredClone(DELIVERED), ...overrides };
}

function response(value: unknown, status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Correos Spain tracking normalization', () => {
  it('accepts Correos-issued codes case-insensitively and rejects the rest', () => {
    expect(normalizeCorreosSpainTrackingNumber('pr123456789012345c')).toBe(TRACKING_NUMBER);
    expect(normalizeCorreosSpainTrackingNumber('PQ0011223344ES')).toBe('PQ0011223344ES');
    for (const raw of ['ABC', '123', '']) {
      expect(() => normalizeCorreosSpainTrackingNumber(raw)).toThrow(TypeError);
    }
    expect(correosSpainTrackingUrl(TRACKING_NUMBER)).toBe(
      'https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=PR123456789012345C',
    );
  });
});

describe('Correos Spain response parsing', () => {
  it('returns delivered history newest-first with Madrid timestamps', () => {
    const result = parseCorreosSpainTrackingResponse([envelope()], TRACKING_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Entregado',
      last_update: '2026-04-29T13:12:42+02:00',
      expected_delivery: null,
    });
    expect(result.events?.map((item) => [item.description, item.stage, item.time])).toEqual([
      ['Entregado', 'delivered', '2026-04-29T13:12:42+02:00'],
      ['En reparto', 'out_for_delivery', '2026-04-29T08:46:00+02:00'],
      ['Clasificado', 'in_transit', '2026-04-28T15:52:17+02:00'],
      ['Admitido', 'registered', '2026-04-27T23:03:58+02:00'],
    ]);
  });

  it('maps documented event codes and reports unmapped ones as unknown', () => {
    const cases: Array<[string, string, string]> = [
      ['A010000V', 'pending', 'registered'],
      ['P101110V', 'in_transit', 'in_transit'],
      ['H01I350V', 'out_for_delivery', 'ready_for_pickup'],
      ['H010930R', 'exception', 'failed_attempt'],
      ['O140000V', 'exception', 'returned'],
      ['X120000V', 'delivered', 'delivered'],
    ];
    for (const [code, status, stage] of cases) {
      expect(classifyCorreosSpainStatus(code)).toEqual({ status, stage });
      const result = parseCorreosSpainTrackingResponse([envelope({
        eventos: [event(code, '29/04/2026', '13:12:42', 'Resumen')],
      })], TRACKING_NUMBER);
      expect(result).toMatchObject({ status, current_stage: stage });
    }
    expect(classifyCorreosSpainStatus('Z999999Z')).toBeUndefined();
    const unknown = parseCorreosSpainTrackingResponse([envelope({
      eventos: [event('Z999999Z', '29/04/2026', '13:12:42', 'Algo nuevo')],
    })], TRACKING_NUMBER);
    expect(unknown).toMatchObject({ status: 'unknown', last_status_text: 'Algo nuevo' });
    // No explicit mapping means no stage at all: the sync classifies the raw
    // wording and records where the final stage came from.
    expect(unknown.events?.[0]).toMatchObject({ description: 'Algo nuevo' });
    expect(unknown.events?.[0]?.stage).toBeUndefined();
  });

  it('binds the envelope codEnvio and honors the codError result', () => {
    expect(() => parseCorreosSpainTrackingResponse([envelope({ codEnvio: 'PR123456789012346C' })], TRACKING_NUMBER))
      .toThrow(SchemaError);
    expect(() => parseCorreosSpainTrackingResponse([envelope({ codEnvio: undefined })], TRACKING_NUMBER))
      .toThrow(SchemaError);
    expect(() => parseCorreosSpainTrackingResponse([envelope({ error: { codError: '3', desError: 'Sin Trazabilidad en Minerva.' }, eventos: null })], TRACKING_NUMBER))
      .toThrow(NotFoundError);
    expect(() => parseCorreosSpainTrackingResponse([], TRACKING_NUMBER)).toThrow(SchemaError);
    expect(() => parseCorreosSpainTrackingResponse([envelope({ error: undefined })], TRACKING_NUMBER))
      .toThrow(SchemaError);
    expect(() => parseCorreosSpainTrackingResponse(null, TRACKING_NUMBER)).toThrow(SchemaError);
  });

  it('keeps codError-0 parcels without events as unknown with the envelope summary', () => {
    const result = parseCorreosSpainTrackingResponse([envelope({
      eventos: [], resumen_ultimo: 'En camino',
    })], TRACKING_NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: 'En camino', events: [] });
  });

  it('skips unusable rows without losing the shipment', () => {
    const result = parseCorreosSpainTrackingResponse([envelope({
      eventos: [
        event('I01H210V', '29/04/2026', '13:12:42', 'Entregado'),
        event('I01H210V', '29/04/2026', '13:12:42', 'Entregado'),
        event('I01H210V', 'not-a-date', '13:12:42', 'Entregado'),
        event('I01H210V', '29/04/2026', '13:12:42', ''),
        'not a record',
      ],
    })], TRACKING_NUMBER);
    // Empty wording falls back to the code, so two rows survive the sparse input.
    expect(result.events?.map((item) => item.description)).toEqual(['Entregado', 'I01H210V']);
  });

  it('retains weight and parcel data, never the customer name or raw keys', () => {
    const result = parseCorreosSpainTrackingResponse([envelope()], TRACKING_NUMBER);
    expect(result.receiver_name).toBeUndefined();
    expect(result).toMatchObject({
      weight_kg: 1.5,
      dimensions_text: '30 x 20 x 10 cm',
      delivered_at: '2026-04-29T13:12:42+02:00',
    });
    const serialized = JSON.stringify(result);
    for (const secret of ['nombre_cliente', 'Example Customer', 'nom_codired', 'peso', 'largo', 'ancho', 'alto']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('never retains the customer address, phone or signature blocks', () => {
    const serialized = JSON.stringify(parseCorreosSpainTrackingResponse([envelope()], TRACKING_NUMBER));
    for (const secret of [
      'Calle Ejemplo 1', '+340000000000', 'Example Signature',
      'direccion_cliente', 'telefono_cliente', 'firma_receptor', 'desTextoAmpliado',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('exposes the office name only while awaiting collection', () => {
    const pickup = parseCorreosSpainTrackingResponse([envelope({
      nom_codired: 'MADRID SUC 37. LA ELIPA',
      eventos: [event('H01I350V', '29/04/2026', '13:12:42', 'En oficina')],
    })], TRACKING_NUMBER);
    expect(pickup).toMatchObject({ pickup_point: 'MADRID SUC 37. LA ELIPA' });
    const delivered = parseCorreosSpainTrackingResponse([envelope()], TRACKING_NUMBER);
    expect(delivered.pickup_point).toBeUndefined();
  });

  it('produces every capability carrier.json declares', () => {
    expect(CAPABILITIES).toEqual(['history', 'pickup_point', 'weight', 'dimensions', 'delivered_at']);
    const delivered = parseCorreosSpainTrackingResponse([envelope()], TRACKING_NUMBER);
    expect(delivered.events?.length).toBeGreaterThan(0);
    expect(delivered.weight_kg).toBe(1.5);
    expect(delivered.dimensions_text).toBe('30 x 20 x 10 cm');
    expect(delivered.delivered_at).toBe('2026-04-29T13:12:42+02:00');
    // The office is only a pickup signal while the parcel awaits collection.
    const pickup = parseCorreosSpainTrackingResponse([envelope({
      eventos: [event('H01I350V', '29/04/2026', '13:12:42', 'En oficina')],
    })], TRACKING_NUMBER);
    expect(pickup.pickup_point).toBe('OFICINA EXAMPLE CENTRAL');
  });
});

describe('CorreosSpainTracker fetch', () => {
  it('calls the localizador endpoint with web-channel params', async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      seen.push(String(input));
      return response([envelope()]);
    });
    const result = await new CorreosSpainTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER);
    expect(result.status).toBe('delivered');
    expect(seen).toEqual([
      'https://localizador.correos.es/canonico/eventos_envio_servicio/PR123456789012345C?codAplicacion=60&codCanal=3&codIdioma=ES&indUltEvento=N',
    ]);
  });

  it('surfaces transport and schema failures distinctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, 503));
    await expect(new CorreosSpainTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ name: 'UpstreamHttpError', status: 503 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('not json', 200));
    await expect(new CorreosSpainTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toThrow(TypeError);
    expect(() => new CorreosSpainTracker({ timeoutMs: 0 })).toThrow(TypeError);
    await expect(new CorreosSpainTracker({ timeoutMs: 1_000 }).fetch('ABC'))
      .rejects.toThrow(TypeError);
  });
});
