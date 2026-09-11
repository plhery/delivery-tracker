import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeCorreosSpainTrackingNumber,
  correosSpainTrackingUrl,
  parseCorreosSpainTrackingResponse,
  CorreosSpainTracker,
  CorreosSpainTrackingError,
} from './correosSpain';

// All identifiers and timestamps below are synthetic. Event codes and Spanish
// wordings reuse the vendor's fixed texts confirmed against a real parcel by
// the prior-art client (ha-correos tests/payloads.py), so classification
// exercises production prose rather than paraphrases.
const TRACKING_NUMBER = 'PR123456789012345C';

function event(code: string, fecha: string, horEvento: string, resumen: string) {
  return { codEvento: code, fecEvento: fecha, horEvento, desTextoResumen: resumen, desTextoAmpliado: resumen };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    codEnvio: TRACKING_NUMBER,
    nombre_cliente: 'Example Customer',
    peso: '1500',
    nom_codired: 'OFICINA EXAMPLE CENTRAL',
    error: { codError: '0', desError: 'OK' },
    eventos: [
      event('A090000V', '27/04/2026', '23:03:58', 'Admitido'),
      event('P040000V', '28/04/2026', '15:52:17', 'Clasificado'),
      event('H020000V', '29/04/2026', '08:46:00', 'En reparto'),
      event('I01H210V', '29/04/2026', '13:12:42', 'Entregado'),
    ],
    ...overrides,
  };
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
      const result = parseCorreosSpainTrackingResponse([envelope({
        eventos: [event(code, '29/04/2026', '13:12:42', 'Resumen')],
      })], TRACKING_NUMBER);
      expect(result).toMatchObject({ status, current_stage: stage });
    }
    const unknown = parseCorreosSpainTrackingResponse([envelope({
      eventos: [event('Z999999Z', '29/04/2026', '13:12:42', 'Algo nuevo')],
    })], TRACKING_NUMBER);
    expect(unknown).toMatchObject({ status: 'unknown', last_status_text: 'Algo nuevo' });
    expect(unknown.events?.[0]).toMatchObject({ stage: 'in_transit' });
  });

  it('binds the envelope codEnvio and honors the codError result', () => {
    expect(() => parseCorreosSpainTrackingResponse([envelope({ codEnvio: 'PR123456789012346C' })], TRACKING_NUMBER))
      .toThrow(RangeError);
    expect(() => parseCorreosSpainTrackingResponse([envelope({ codEnvio: undefined })], TRACKING_NUMBER))
      .toThrow(TypeError);
    expect(() => parseCorreosSpainTrackingResponse([envelope({ error: { codError: '3', desError: 'Sin Trazabilidad en Minerva.' }, eventos: null })], TRACKING_NUMBER))
      .toThrow(CorreosSpainTrackingError);
    expect(() => parseCorreosSpainTrackingResponse([], TRACKING_NUMBER)).toThrow(TypeError);
    expect(() => parseCorreosSpainTrackingResponse([envelope({ error: undefined })], TRACKING_NUMBER))
      .toThrow(TypeError);
    expect(() => parseCorreosSpainTrackingResponse(null, TRACKING_NUMBER)).toThrow(TypeError);
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

  it('never retains customer, dimension or office data', () => {
    const result = parseCorreosSpainTrackingResponse([envelope()], TRACKING_NUMBER);
    const serialized = JSON.stringify(result);
    for (const secret of ['Example Customer', 'OFICINA EXAMPLE', 'nombre_cliente', 'nom_codired', 'peso']) {
      expect(serialized).not.toContain(secret);
    }
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
