import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { normalizeCarrierResult } from '../../core/result';
import { adapter, parsePocztaPolskaBootstrap, PocztaPolskaTracker } from './adapter';
import { normalizePocztaPolskaNumber, parsePocztaPolska } from './parser';
import { classifyPocztaPolskaStatus } from './status';

const NUMBER = '00000000000000000001';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const bootstrap = readFileSync(new URL('./fixtures/bootstrap.html', import.meta.url), 'utf8');
const payload = () => structuredClone(fixture);
const negative = () => ({ number: NUMBER, mailStatus: -1 });

describe('Poczta Polska identity-bound scans', () => {
  it('preserves local digits, office names and explicit kg weight without addresses or invented offsets', () => {
    const result = normalizeCarrierResult(parsePocztaPolska(payload(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: null,
      last_update_local: '2026-01-06T12:00:00', weight_kg: 0.35, expected_delivery: null });
    expect(result.events?.map(event => event.stage)).toEqual(['delivered', 'out_for_delivery', 'exception', 'accepted', 'registered']);
    expect(result.events?.[0]).toMatchObject({ location: 'Example Post Office', description: 'Final delivery', provider_code: 'P_D' });
    expect(result.events?.every(event => event.local_time && !event.time)).toBe(true);
    expect(result).not.toHaveProperty('delivered_at'); expect(result).not.toHaveProperty('timezone');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|openingHours|additionalServices|dispatchDate/);
    const declared = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: Boolean(result.events?.length),
      location: Boolean(result.events?.[0]?.location), weight: result.weight_kg === 0.35 };
    for (const capability of declared.capabilities) expect(evidence[capability], capability).toBe(true);
  });

  it('requires both exact identities and rejects malformed envelopes', () => {
    const wrong = payload(); wrong.number = '00000000000000000002';
    const inner = payload(); inner.mailInfo.number = '00000000000000000002';
    const punctuation = payload(); punctuation.mailInfo.number = '0000000000 0000000001';
    for (const value of [null, {}, { number: NUMBER, mailStatus: '0' }, { number: NUMBER, mailStatus: 0 }, wrong, inner, punctuation]) {
      expect(() => parsePocztaPolska(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const padded = payload(); padded.number = ` ${NUMBER} `; padded.mailInfo.number = ` ${NUMBER} `;
    expect(parsePocztaPolska(padded, NUMBER).status).toBe('delivered');
  });

  it('keeps ambiguous reuse, empty history and generic errors distinct from explicit absence', () => {
    expect(() => parsePocztaPolska(negative(), NUMBER)).toThrowError(expect.objectContaining({ kind: 'not_found' }));
    const mixed = { ...negative(), mailInfo: payload().mailInfo };
    const empty = payload(); empty.mailInfo.events = [];
    for (const value of [mixed, empty, { ...negative(), mailStatus: 1 }, { ...negative(), mailStatus: -2 },
      { ...negative(), mailStatus: -99 }]) {
      expect(() => parsePocztaPolska(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const wrong = negative(); wrong.number = '00000000000000000002';
    expect(() => parsePocztaPolska(wrong, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['2026-02-30T12:00:00', '2026-01-06T12:00:00+02:99', '2026-01-06T12:00:00+99:00', '12:00', '', null])(
    'retains an unresolved newest clock %s without promoting earlier dated history', (time) => {
      const value = payload(); value.mailInfo.events.at(-1).time = time;
      const result = parsePocztaPolska(value, NUMBER);
      expect(result).toMatchObject({ status: 'delivered', last_update: null });
      expect(result.events?.[0].description).toBe('Final delivery');
      expect(result.events?.[0]).not.toHaveProperty('time'); expect(result.events?.[0]).not.toHaveProperty('local_time');
      if (time) expect(result.events?.[0]).toMatchObject({ provider_time_text: time });
    });

  it('uses explicit offsets when provided and keeps local order across countries', () => {
    const explicit = payload(); for (const event of explicit.mailInfo.events) event.time += '+01:00';
    expect(parsePocztaPolska(explicit, NUMBER)).toMatchObject({ last_update: '2026-01-06T12:00:00+01:00' });
    const relayed = payload(); relayed.mailInfo.recipientCountryCode = 'NZ';
    relayed.mailInfo.events.at(-2).time = '2026-01-07T08:00:00';
    expect(parsePocztaPolska(relayed, NUMBER).last_update_local).toBe('2026-01-06T12:00:00');
    expect(parsePocztaPolska(relayed, NUMBER).events?.[0].description).toBe('Final delivery');
  });

  it('uses specific failure codes and never borrows a broad state or finished flag for unknown scans', () => {
    const failed = payload(); failed.mailInfo.events = [failed.mailInfo.events[2]];
    expect(parsePocztaPolska(failed, NUMBER)).toMatchObject({ status: 'exception', current_stage: 'exception' });
    const unknown = payload(); Object.assign(unknown.mailInfo.events.at(-1), { code: '__proto__', name: 'Unmapped scan' });
    expect(parsePocztaPolska(unknown, NUMBER).status).toBe('unknown');
    expect(parsePocztaPolska(unknown, NUMBER)).not.toHaveProperty('current_stage');
    expect(parsePocztaPolska(unknown, NUMBER).events?.[0]).not.toHaveProperty('stage');
    expect(classifyPocztaPolskaStatus('constructor')).toBeUndefined();
  });

  it('uses the widget check-digit alias while requiring the full returned barcode', () => {
    const prefix = '0000000000000000001';
    const canonical = normalizePocztaPolskaNumber(prefix);
    expect(canonical).toBe('00000000000000000017');
    const value = payload(); value.number = canonical; value.mailInfo.number = canonical;
    expect(parsePocztaPolska(value, prefix).canonical_tracking_number).toBe(canonical);
    value.number = prefix;
    expect(() => parsePocztaPolska(value, prefix)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    expect(normalizePocztaPolskaNumber('px 0000000001')).toBe('PX0000000001');
    expect(normalizePocztaPolskaNumber('rr 000000005 pl')).toBe('RR000000005PL');
  });

  it('bounds history, refuses grouped and invalidated scans, and deduplicates only exact projections', () => {
    const invalidated = payload(); invalidated.mailInfo.events.at(-1).canceled = true;
    const pallet = payload(); pallet.mailInfo.typeOfMailCode = 'PPL';
    const components = payload(); components.mailInfo.components = ['PX0000000001', 'PX0000000002'];
    const single = payload(); single.mailInfo.components = ['PX0000000001'];
    for (const value of [invalidated, pallet, components, single]) expect(() => parsePocztaPolska(value, NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    for (const components of [{}, 'PX0000000001', [null], ['']]) {
      const value = payload(); value.mailInfo.components = components;
      expect(() => parsePocztaPolska(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    for (const components of [null, []]) {
      const value = payload(); value.mailInfo.components = components;
      expect(parsePocztaPolska(value, NUMBER).status).toBe('delivered');
    }
    for (const scan of [null, {}, { name: 'Final delivery', code: 'P_D', time: 123 }]) {
      const value = payload(); value.mailInfo.events.push(scan);
      expect(() => parsePocztaPolska(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const duplicate = payload(); duplicate.mailInfo.events.push(duplicate.mailInfo.events.at(-1));
    expect(parsePocztaPolska(duplicate, NUMBER).events).toHaveLength(5);
    const excessive = payload(); excessive.mailInfo.events = Array(501).fill(excessive.mailInfo.events[0]);
    expect(() => parsePocztaPolska(excessive, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    for (const weight of [0, -1, '0.35', null, Infinity]) {
      const value = payload(); value.mailInfo.weight = weight;
      expect(parsePocztaPolska(value, NUMBER)).not.toHaveProperty('weight_kg');
    }
  });
});

describe('Poczta Polska public widget request', () => {
  it('validates one pinned public configuration before sending two bounded anonymous requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(bootstrap))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload())));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    await expect(instance.track({ number: NUMBER })).resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://emonitoring.poczta-polska.pl/');
    const [url, init] = fetcher.mock.calls[1];
    expect(String(url)).toBe('https://uss.poczta-polska.pl/uss/v2.0/tracking/checkmailex');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error',
      body: JSON.stringify({ language: 'EN', number: NUMBER, addPostOfficeInfo: false }) });
    const headers = new Headers(init?.headers);
    expect(headers.get('API_KEY')).toBe('synthetic-public-widget-configuration-key');
    expect(headers.has('Cookie')).toBe(false); expect(headers.has('Authorization')).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    for (const html of ['', bootstrap + bootstrap, bootstrap.replace('uss.poczta-polska.pl', 'untrusted.example'),
      bootstrap.replace('synthetic-public-widget-configuration-key', '')]) {
      expect(() => parsePocztaPolskaBootstrap(html)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('recognizes exact history and proven absence while preserving ambiguous failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(bootstrap))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload())))
      .mockResolvedValueOnce(new Response(bootstrap)).mockResolvedValueOnce(new Response(JSON.stringify(negative())))
      .mockResolvedValueOnce(new Response(bootstrap)).mockResolvedValueOnce(new Response(JSON.stringify({ ...negative(), mailStatus: 1 })));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    await expect(instance.recognize!('123')).resolves.toEqual({ known: false });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: true, lastActivityAt: null });
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: false });
    await expect(instance.recognize!(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
  });

  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])(
    'keeps HTTP %s distinct from parcel absence', async (status, kind) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('unavailable', { status: Number(status) }));
      await expect(new PocztaPolskaTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledOnce();
    });

  it('rejects invalid inputs and cancels before sending the tracking query', async () => {
    const unused = vi.fn<typeof fetch>();
    for (const number of ['123', 'RR000000006PL', `${NUMBER}&payment=1`]) {
      expect(() => new PocztaPolskaTracker({ fetcher: unused }).fetch(number)).toThrow(TypeError);
    }
    await expect(new PocztaPolskaTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return new Response(bootstrap); });
    await expect(new PocztaPolskaTracker({ fetcher }).fetch(NUMBER, { signal: controller.signal })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(500_001)));
    await expect(new PocztaPolskaTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });
});
