import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, normalizeTntExpressNumber, normalizeTntFranceNumber, parseTntExpressResponse, parseTntFranceResponse, TntExpressTracker, TntFranceTracker } from './adapter';
import { tntExpressStatus } from './status';

const NUMBER = '1000000000000001';
const fixture = () => readFileSync(new URL('./fixtures/registered.html', import.meta.url), 'utf8');
const EXPRESS_NUMBER = '100000001';
const express = () => JSON.parse(readFileSync(new URL('./fixtures/express.json', import.meta.url), 'utf8'));
const tracker = (fetcher: typeof fetch) => adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });

describe('TNT France public tracking', () => {
  it('returns the reached milestone and ignores future delivery labels and FAQs', () => {
    const result = parseTntFranceResponse(fixture(), NUMBER);
    expect(result).toMatchObject({ status: 'pending', current_stage: 'registered', last_update: '2026-03-27T11:25:00+01:00' });
    expect(result.events).toEqual([{ time: '2026-03-27T11:25:00+01:00', description: "Colis chez l'expéditeur", stage: 'registered' }]);
  });

  it('requires actual detail identity and rejects an echoed form input', () => {
    expect(() => parseTntFranceResponse(fixture().replace('id="ancestor"', 'id="wrong"'), NUMBER)).toThrow('matching shipment');
    expect(() => parseTntFranceResponse(fixture().replace('Bon de transport nº 1000000000000001', 'Bon de transport nº 1000000000000002'), NUMBER)).toThrow('matching shipment');
    expect(() => parseTntFranceResponse(`<textarea name="bonTransport">${NUMBER}</textarea>`, NUMBER)).toThrow('matching shipment');
  });

  it('separates structured not-found from an empty form and hidden errors', () => {
    expect(() => parseTntFranceResponse(`<div id="saisieBTMsg">Nous n'avons pas trouvé de colis associé à votre recherche, veuillez vérifier votre saisie ou réessayer ultérieurement.</div>`, NUMBER)).toThrow('could not locate');
    expect(() => parseTntFranceResponse('<html>Service temporarily unavailable</html>', NUMBER)).toThrow('matching shipment');
    const hidden = fixture().replace('</body>', `<div id="saisieBTMsg" style="display:none">Nous n'avons pas trouvé de colis associé à votre recherche</div></body>`);
    expect(parseTntFranceResponse(hidden, NUMBER).status).toBe('pending');
  });

  it('keeps unfamiliar milestones unresolved and rejects malformed history', () => {
    expect(parseTntFranceResponse(fixture().replaceAll("Colis chez l'expéditeur", 'New milestone'), NUMBER).status).toBe('unknown');
    expect(() => parseTntFranceResponse(fixture().replace('27/03/2026', '32/03/2026'), NUMBER)).toThrow('incomplete tracking row');
    expect(() => parseTntFranceResponse(fixture().replace('Etapes de votre expédition', 'Changed header'), NUMBER)).toThrow('unique tracking history');
  });

  it('classifies a synthetic delivered history independently of older scans', () => {
    const html = fixture().replaceAll('class="suivi-title-selected"', 'class=""')
      .replace('<p>Livré</p>', '<p class="suivi-title-selected">Livré</p>')
      .replace('<div class="roster tnt-even">', '<div class="roster tnt-even"><div class="roster__item">Livré</div><div class="roster__item">29/03/2026 14:00</div><div class="roster__item">Synthetic depot</div></div><div class="roster tnt-even">');
    expect(parseTntFranceResponse(html, NUMBER)).toMatchObject({ status: 'delivered', events: [{ stage: 'delivered', time: '2026-03-29T14:00:00+02:00' }, { stage: 'registered' }] });
  });

  it('sends international numbers to tnt.com and other shapes nowhere', async () => {
    expect(() => normalizeTntFranceNumber('123456789')).toThrow('16-digit');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => new URL(String(url)).hostname === 'www.tnt.fr'
      ? new Response(fixture()) : new Response(JSON.stringify(express())));
    await expect(tracker(fetcher).recognize!('12345678')).resolves.toEqual({ known: false });
    await expect(tracker(fetcher).track({ number: '12345678' })).rejects.toMatchObject({ kind: 'input_required' });
    expect(fetcher).not.toHaveBeenCalled();
    await tracker(fetcher).track({ number: EXPRESS_NUMBER });
    await tracker(fetcher).track({ number: NUMBER });
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(['www.tnt.com', 'www.tnt.fr']);
  });

  it('uses one bounded detail request and respects cancellation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(fixture()));
    await new TntFranceTracker({ fetcher }).fetch(NUMBER, { budgetMs: 900.1 });
    const [rawUrl, init] = fetcher.mock.calls[0]!;
    expect(new URL(String(rawUrl)).searchParams.get('bonTransport')).toBe(NUMBER);
    expect(init).toMatchObject({ redirect: 'error', cache: 'no-store' });
    await expect(new TntFranceTracker({ fetcher }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('decodes the page charset and keeps endpoint failures separate from parcel misses', async () => {
    const latin = Uint8Array.from(Buffer.from(fixture(), 'latin1'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(latin, { headers: { 'content-type': 'text/html;charset=ISO-8859-1' } }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    expect((await new TntFranceTracker({ fetcher }).fetch(NUMBER)).status).toBe('pending');
    await expect(new TntFranceTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
  });
});

describe('TNT international public tracking', () => {
  it('reads the newest consignment that carried the number, newest scan first', () => {
    const result = parseTntExpressResponse(express(), EXPRESS_NUMBER);
    expect(result).toMatchObject({
      status: 'in_transit', current_stage: 'in_transit', last_status_text: 'Shipment in transit',
      last_update: '2026-03-27T09:40:00+08:00', expected_delivery: '2026-04-02',
    });
    expect(result.events).toEqual([
      { time: '2026-03-27T09:40:00+08:00', description: 'Shipment in transit', location: 'Synthetic Hub, China', provider_code: 'OS', stage: 'in_transit' },
      { time: '2026-03-27T09:30:00+08:00', description: 'Shipment in transit', location: 'Synthetic Hub, China', provider_code: 'TR', stage: 'in_transit' },
      { time: '2026-03-27T09:10:00+08:00', description: 'Shipment collected from collection address', location: 'Synthetic Origin, China', provider_code: 'PU', stage: 'accepted' },
    ]);
    // References, signatures and addresses stay with TNT.
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC-REFERENCE|SYNTHETIC SIGNATORY|Destination|Earlier|Other/);
  });

  it('never reads another number and separates not-found from other replies', () => {
    const payload = express();
    payload['tracker.output'].consignment = payload['tracker.output'].consignment.slice(2);
    expect(() => parseTntExpressResponse(payload, EXPRESS_NUMBER)).toThrow('different shipment');
    const missing = (input: string) => ({ 'tracker.output': { notFound: [{ input, hints: { invalidInput: false, carrier: null } }] } });
    expect(() => parseTntExpressResponse(missing(EXPRESS_NUMBER), EXPRESS_NUMBER)).toThrow('could not locate');
    expect(() => parseTntExpressResponse(missing('100000002'), EXPRESS_NUMBER)).toThrow('invalid tracking response');
    expect(() => parseTntExpressResponse({ error: 'unavailable' }, EXPRESS_NUMBER)).toThrow('invalid tracking response');
    expect(() => normalizeTntExpressNumber('1000000000000001')).toThrow('9-digit');
  });

  it('keeps delivery, partial delivery and unfamiliar codes apart', () => {
    const payload = express();
    const [current] = payload['tracker.output'].consignment;
    current.events.unshift({ date: '2026-04-01T11:00:00+02:00', legacyCode: 'OK', statusDescription: 'Shipment delivered in good condition', location: null });
    current.analytics.destinationDateSources.usedDate = 'delivered';
    expect(parseTntExpressResponse(payload, EXPRESS_NUMBER)).toMatchObject({ status: 'delivered', current_stage: 'delivered', expected_delivery: null });
    current.events[0] = { ...current.events[0], legacyCode: 'LP', statusDescription: 'Shipment partially delivered. Recovery actions underway' };
    expect(parseTntExpressResponse(payload, EXPRESS_NUMBER)).toMatchObject({ status: 'exception', current_stage: 'exception' });
    current.events[0] = { ...current.events[0], legacyCode: 'ZZ', statusDescription: 'New milestone' };
    const unfamiliar = parseTntExpressResponse(payload, EXPRESS_NUMBER);
    expect(unfamiliar.status).toBe('unknown');
    expect(unfamiliar).not.toHaveProperty('current_stage');
    expect(unfamiliar.events?.[0]).not.toHaveProperty('stage');
    expect(tntExpressStatus('RTS')?.stage).toBe('returned');
    expect(tntExpressStatus('constructor')).toBeUndefined();
  });

  it('requires offsets and wording, and leaves an empty history inconclusive', () => {
    const payload = express();
    payload['tracker.output'].consignment[0].events[0].date = '2026-03-27T09:40:00';
    expect(() => parseTntExpressResponse(payload, EXPRESS_NUMBER)).toThrow('incomplete scan');
    const empty = express();
    empty['tracker.output'].consignment = empty['tracker.output'].consignment.slice(0, 1);
    empty['tracker.output'].consignment[0].events = [];
    expect(() => parseTntExpressResponse(empty, EXPRESS_NUMBER)).toThrow('without tracking history');
  });

  it('makes one bounded anonymous read, honours cancellation and keeps outages apart', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(express())));
    await new TntExpressTracker({ fetcher }).fetch(EXPRESS_NUMBER, { budgetMs: 900.1 });
    const [rawUrl, init] = fetcher.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.origin + url.pathname).toBe('https://www.tnt.com/api/v3/shipment');
    expect(Object.fromEntries(url.searchParams)).toEqual({ con: EXPRESS_NUMBER, searchType: 'CON', locale: 'en_GB', channel: 'OPENTRACK' });
    expect(init).toMatchObject({ redirect: 'error', cache: 'no-store' });
    await expect(new TntExpressTracker({ fetcher }).fetch(EXPRESS_NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(new TntExpressTracker({ fetcher }).fetch(EXPRESS_NUMBER)).rejects.toMatchObject({ kind: 'transport' });
  });

  it('recognizes a nine-digit number only from a matching consignment', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(express())))
      .mockResolvedValueOnce(new Response(JSON.stringify({ 'tracker.output': { notFound: [{ input: EXPRESS_NUMBER }] } })));
    await expect(tracker(fetcher).recognize!(EXPRESS_NUMBER)).resolves.toEqual({ known: true, lastActivityAt: '2026-03-27T01:40:00.000Z' });
    await expect(tracker(fetcher).recognize!(EXPRESS_NUMBER)).resolves.toEqual({ known: false });
  });
});
