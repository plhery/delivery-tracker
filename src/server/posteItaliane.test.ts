import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizePosteItalianeTrackingNumber,
  posteItalianeTrackingUrl,
  parsePosteItalianeTrackingResponse,
  PosteItalianeTracker,
  PosteItalianeTrackingError,
} from './posteItaliane';

// All identifiers and timestamps below are synthetic. Italian status wordings
// reuse the vendor's fixed texts confirmed against a real parcel by the
// prior-art client (ha-poste-italiane tests/payloads.py), so classification
// exercises production prose rather than paraphrases.
const TRACKING_NUMBER = 'RA00000000001';

function movement(wording: string, millis: number) {
  return { statoLavorazione: wording, dataOra: millis, luogo: 'Test Depot' };
}

function parcel(overrides: Record<string, unknown> = {}) {
  return {
    esitoRicerca: '3',
    idTracciatura: TRACKING_NUMBER,
    tipoProdotto: 'POSTEDELIVERY EUROPE',
    tipoSpedizione: 'P',
    stato: '5',
    flagRitorno: false,
    dataPrevistaConsegna: 'Consegna prevista entro Venerdì 2 Gennaio 2026',
    listaMovimenti: [
      movement('la spedizione è stata presa in carico da un nostro operatore', 1767225600000),
      movement('la spedizione è in transito presso il Centro di lavorazione Internazionale', 1767312000000),
      movement('la spedizione è in consegna', 1767398400000),
      movement('la spedizione è stata consegnata', 1767484800000),
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

describe('Poste Italiane tracking normalization', () => {
  it('accepts the detected Poste Italiane families and rejects the rest', () => {
    expect(normalizePosteItalianeTrackingNumber('ra00000000001')).toBe(TRACKING_NUMBER);
    expect(normalizePosteItalianeTrackingNumber('1UW1G2J193065')).toBe('1UW1G2J193065');
    expect(normalizePosteItalianeTrackingNumber('2IMA0051035900')).toBe('2IMA0051035900');
    for (const raw of ['12345', 'Z8328162951', 'LD156008025FR', '']) {
      expect(() => normalizePosteItalianeTrackingNumber(raw)).toThrow(TypeError);
    }
    expect(posteItalianeTrackingUrl(TRACKING_NUMBER)).toBe(
      'https://www.poste.it/cerca/index.html#/risultati-spedizioni/RA00000000001',
    );
  });
});

describe('Poste Italiane response parsing', () => {
  it('returns delivered history newest-first with UTC epoch times', () => {
    const result = parsePosteItalianeTrackingResponse(parcel(), TRACKING_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'la spedizione è stata consegnata',
      last_update: '2026-01-04T00:00:00.000Z',
      // The estimate is meaningless once delivered, so it is cleared even though
      // the envelope carries dataPrevistaConsegna (checked on active parcels below).
      expected_delivery: null,
    });
    expect(result.events?.map((event) => [(event.description ?? '').slice(0, 30), event.stage, event.time])).toEqual([
      ['la spedizione è stata consegna', 'delivered', '2026-01-04T00:00:00.000Z'],
      ['la spedizione è in consegna', 'out_for_delivery', '2026-01-03T00:00:00.000Z'],
      ['la spedizione è in transito pr', 'in_transit', '2026-01-02T00:00:00.000Z'],
      ['la spedizione è stata presa in', 'registered', '2026-01-01T00:00:00.000Z'],
    ]);
  });

  it('maps documented wordings and reports unmapped ones as unknown', () => {
    const cases: Array<[string, string, string]> = [
      ['a seguito di acquisto da poste.it', 'pending', 'registered'],
      // ASCII-apostrophe variant observed live on a delivered parcel.
      ["la spedizione e' stata consegnata", 'delivered', 'delivered'],
      ['completata la fase di verifica per lo svincolo doganale', 'in_transit', 'in_transit'],
      ['consegna non andata a buon fine, riproveremo', 'exception', 'failed_attempt'],
      ['in restituzione al mittente', 'exception', 'returned'],
      ['disponibile per il ritiro dal giorno lavorativo successivo alla data indicata', 'out_for_delivery', 'ready_for_pickup'],
      ["all'estero", 'in_transit', 'in_transit'],
      ['sono in corso delle verifiche sulla spedizione. contatta assistenza', 'exception', 'failed_attempt'],
    ];
    for (const [wording, status, stage] of cases) {
      const result = parsePosteItalianeTrackingResponse(parcel({
        stato: '4',
        listaMovimenti: [movement(wording, 1767484800000)],
      }), TRACKING_NUMBER);
      expect(result).toMatchObject({ status, current_stage: stage });
    }
    // The Italian estimate text reduces to its local calendar day on active parcels.
    expect(parsePosteItalianeTrackingResponse(parcel({
      stato: '4',
      listaMovimenti: [movement('la spedizione è in consegna', 1767484800000)],
    }), TRACKING_NUMBER).expected_delivery).toBe('2026-01-02');
    const unknown = parsePosteItalianeTrackingResponse(parcel({
      stato: '4',
      listaMovimenti: [movement('qualcosa di completamente nuovo', 1767484800000)],
    }), TRACKING_NUMBER);
    expect(unknown).toMatchObject({ status: 'unknown', last_status_text: 'qualcosa di completamente nuovo' });
    expect(unknown.events?.[0]).toMatchObject({ stage: 'in_transit' });
  });

  it('binds the idTracciatura echo and honors the esito envelope', () => {
    expect(() => parsePosteItalianeTrackingResponse(parcel({ idTracciatura: 'RA00000000002' }), TRACKING_NUMBER))
      .toThrow(RangeError);
    expect(() => parsePosteItalianeTrackingResponse(parcel({ idTracciatura: undefined }), TRACKING_NUMBER))
      .toThrow(TypeError);
    // Documented unknown outcomes, with or without movements present.
    expect(() => parsePosteItalianeTrackingResponse(parcel({ esitoRicerca: '1', listaMovimenti: [] }), TRACKING_NUMBER))
      .toThrow(PosteItalianeTrackingError);
    expect(() => parsePosteItalianeTrackingResponse(parcel({ esitoRicerca: '2', listaMovimenti: [] }), TRACKING_NUMBER))
      .toThrow(PosteItalianeTrackingError);
    // Observed expired shape: no esitoRicerca, empty movements.
    expect(() => parsePosteItalianeTrackingResponse(
      { idTracciatura: TRACKING_NUMBER, tipoSpedizione: 'P', listaMovimenti: [] }, TRACKING_NUMBER,
    )).toThrow(PosteItalianeTrackingError);
    // Found parcel awaiting its first scan stays pending, not unknown.
    expect(parsePosteItalianeTrackingResponse(parcel({ stato: '4', listaMovimenti: [] }), TRACKING_NUMBER))
      .toMatchObject({ status: 'pending', current_stage: 'registered', events: [] });
    expect(() => parsePosteItalianeTrackingResponse(null, TRACKING_NUMBER)).toThrow(TypeError);
    expect(() => parsePosteItalianeTrackingResponse(parcel({ listaMovimenti: {} }), TRACKING_NUMBER))
      .toThrow(TypeError);
  });

  it('skips unusable rows without losing the shipment', () => {
    const result = parsePosteItalianeTrackingResponse(parcel({
      listaMovimenti: [
        movement('la spedizione è stata consegnata', 1767484800000),
        movement('la spedizione è stata consegnata', 1767484800000),
        movement('', 1767484800000),
        movement('la spedizione è stata consegnata', -5),
        'not a record',
      ],
    }), TRACKING_NUMBER);
    expect(result.events).toHaveLength(1);
  });

  it('never retains customer, dimension, office or estimate-source data', () => {
    const result = parsePosteItalianeTrackingResponse(parcel({
      nombre_cliente: 'Example Customer',
      nom_codired: 'OFICINA EXAMPLE',
      dataPrevistaConsegna: 'garbage',
    }), TRACKING_NUMBER);
    const serialized = JSON.stringify(result);
    for (const secret of ['Example Customer', 'OFICINA EXAMPLE', 'nombre_cliente', 'nom_codired', 'garbage']) {
      expect(serialized).not.toContain(secret);
    }
    expect(result.expected_delivery).toBeNull();
  });
});

describe('PosteItalianeTracker fetch', () => {
  it('posts the DoveQuando body with web-channel headers', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      seen.push({ url: String(input), body: String(init?.body) });
      return response(parcel());
    });
    const result = await new PosteItalianeTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER);
    expect(result.status).toBe('delivered');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://www.poste.it/online/dovequando/DQ-REST/ricercasemplice');
    expect(JSON.parse(seen[0]!.body)).toEqual({
      codiceSpedizione: TRACKING_NUMBER, tipoRichiedente: 'WEB', periodoRicerca: 1,
    });
  });

  it('surfaces transport and schema failures distinctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, 503));
    await expect(new PosteItalianeTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ name: 'UpstreamHttpError', status: 503 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('not json', 200));
    await expect(new PosteItalianeTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toThrow(TypeError);
    expect(() => new PosteItalianeTracker({ timeoutMs: 0 })).toThrow(TypeError);
    await expect(new PosteItalianeTracker({ timeoutMs: 1_000 }).fetch('nope'))
      .rejects.toThrow(TypeError);
  });
});
