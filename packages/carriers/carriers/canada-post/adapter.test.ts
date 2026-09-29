import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapter, CanadaPostTracker, canadaPostTrackingUrl, parseCanadaPostTrackingResponse } from './adapter';
import { canadaPostLookupKind, normalizeCanadaPostNumber, resolveCanadaPostPin } from './parser';
import { canadaPostPackageStage, canadaPostStage, canadaPostStatus } from './status';
import { BudgetExceededError, carrierErrorKind, IndeterminateError, SchemaError } from '../../core/errors';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';

const NUMBER = '0073938000999999';
const MOVING_NUMBER = '0073938000888888';
const RETURN_NUMBER = '0073938000777777';
const NOTICE = '000000000000001';
const REFERENCE = '0000000000001';
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const delivered = () => read('delivered');
const moving = () => read('in-transit');
const returning = () => read('return-progress');
const parse = (payload: unknown, number = NUMBER) => parseCanadaPostTrackingResponse(payload, number);
const environment = (fetcher: typeof fetch) => ({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
afterEach(() => vi.restoreAllMocks());

describe('Canada Post native history', () => {
  it('reads offset clocks, the named summary, delivery scan and facility fields', () => {
    const result = normalizeCarrierResult(parse(delivered()));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_status_text: 'Delivered',
      last_update: '2026-03-14T08:00:34-05:00', delivered_at: '2026-03-14T08:00:34-05:00', expected_delivery: null });
    expect(result.events).toHaveLength(5);
    expect(result.events?.[0]).toMatchObject({ description: 'Signature available', provider_code: '20' });
    expect(result.events?.[0]).not.toHaveProperty('stage');
    expect(result.events?.[1]).toMatchObject({ description: 'Delivered', stage: 'delivered', location: 'EXAMPLE CITY, ON', provider_code: '1466' });
  });

  it('retains a current outbound estimate with known native movement', () => {
    expect(parse(moving(), MOVING_NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'in_transit',
      last_update: '2026-03-15T22:41:00-05:00', expected_delivery: '2026-03-20' });
  });

  it('projects every declared capability without sensitive blocks', () => {
    const meta = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    expect(meta.capabilities).toEqual(['history', 'location', 'eta', 'delivered_at']);
    const result = parse(delivered());
    expect(result.events?.some(event => event.location)).toBe(true);
    expect(result.delivered_at).toBeTruthy();
    expect(parse(moving(), MOVING_NUMBER).expected_delivery).toBeTruthy();
    const encoded = JSON.stringify(result);
    for (const value of ['PRIVATE', 'signatureNm', 'shipToAddr', 'postCd', 'deliveryOptions', 'productNmEn', 'photoConfURL']) expect(encoded).not.toContain(value);
  });

  it('uses the official package vocabulary with corrected progress and pickup meanings', () => {
    expect(canadaPostPackageStage('HalfAccepted')).toBe('registered');
    expect(canadaPostPackageStage('FullProgress')).toBe('out_for_delivery');
    expect(canadaPostPackageStage('HalfDelivered')).toBe('failed_attempt');
    expect(canadaPostPackageStage('ReadyPickup')).toBe('ready_for_pickup');
    expect(canadaPostStatus('5', 'In transit')).toBe('out_for_delivery');
    expect(canadaPostStage('Item available for pick-up')).toBe('ready_for_pickup');
    expect(canadaPostStage('Notice left')).toBe('failed_attempt');
    expect(canadaPostStage('Item has been returned and is enroute to the Sender')).toBe('in_transit');
  });

  it.each(['constructor', '__proto__', 'Unrecognized'])('keeps an unknown latest label without inherited status mapping (%s)', label => {
    const p = moving(); p.status = label; p.events[0].cd = 'NEW_CODE'; p.events[0].descEn = 'New native scan label';
    const result = normalizeCarrierResult(parse(p, MOVING_NUMBER));
    expect(result).toMatchObject({ status: 'unknown', last_status_text: 'New native scan label', expected_delivery: null });
    expect(result).not.toHaveProperty('current_stage');
    expect(result.events?.[0]).not.toHaveProperty('stage');
  });

  it('does not promote an old delivery or attempt time to a current delivered summary', () => {
    const p = delivered(); p.events.shift(); p.events.shift();
    const result = parse(p);
    expect(result).toMatchObject({ status: 'delivered', last_update: null, expected_delivery: null });
    expect(result).not.toHaveProperty('delivered_at');
    expect(result.events?.[0]).toEqual({ description: 'Delivered', stage: 'delivered', summary_snapshot: true });
  });

  it('does not use a later signature clock as delivery time', () => {
    const p = delivered(); p.events[0].datetime.date = '2026-03-15';
    const result = parse(p);
    expect(result.last_update).toBeNull();
    expect(result).not.toHaveProperty('delivered_at');
    expect(result.events?.[0]?.summary_snapshot).toBe(true);
  });

  it('suppresses a mismatched actual-delivery day and never uses an attempted day', () => {
    const p = delivered(); p.actualDlvryDate = '2026-03-15'; p.attemptedDlvryDate = '2026-03-14';
    expect(parse(p)).not.toHaveProperty('delivered_at');
  });

  it('deduplicates exact projected repeats and caps output after validating every row', () => {
    const p = moving(); p.events = Array.from({ length: 130 }, (_, index) => ({ ...p.events[0], cd: `UNKNOWN_${index}`, descEn: `Scan ${index}` }));
    p.events.push(structuredClone(p.events[0]));
    expect(parse(p, MOVING_NUMBER).events).toHaveLength(100);
    p.events.push(null);
    expect(() => parse(p, MOVING_NUMBER)).toThrow(SchemaError);
  });
});

describe('Canada Post return continuity', () => {
  it('retains return progress without turning the native returned flag into completion', () => {
    const result = parse(returning(), RETURN_NUMBER);
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'in_transit', expected_delivery: null });
    expect(result.events?.[0]).toMatchObject({ stage: 'in_transit', provider_leg: 'return', provider_code: '2600' });
    expect(result.events?.[1]).toMatchObject({ stage: 'exception', provider_leg: 'return' });
    expect(result.events?.[2]).toMatchObject({ stage: 'ready_for_pickup' });
    expect(result.events?.[2]).not.toHaveProperty('provider_leg');
    expect(result).not.toHaveProperty('delivered_at');
  });

  it('preserves movement after a return cue and converts only later completed delivery', () => {
    const p = returning();
    const delivery = structuredClone(delivered().events[1]); delivery.datetime.date = '2026-03-20';
    const movement = structuredClone(moving().events[0]); movement.datetime.date = '2026-03-19';
    p.events.unshift(delivery, movement); p.status = 'Delivered'; p.actualDlvryDate = '2026-03-20';
    const result = parse(p, RETURN_NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned', last_status_text: 'Returned to sender', expected_delivery: null });
    expect(result.events?.[0]).toMatchObject({ stage: 'returned', provider_leg: 'return' });
    expect(result.events?.[1]).toMatchObject({ stage: 'in_transit', provider_leg: 'return' });
    expect(result).not.toHaveProperty('delivered_at');
  });

  it('keeps an old outbound delivery when only the summary flag announces return', () => {
    const p = delivered(); p.returnedToSender = true;
    const result = parse(p);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'exception', last_status_text: 'Return to sender', last_update: null, expected_delivery: null });
    expect(result.events?.[0]).toMatchObject({ summary_snapshot: true, provider_leg: 'return', stage: 'exception' });
    expect(result.events?.[2]).toMatchObject({ stage: 'delivered' });
    expect(result.events?.[2]).not.toHaveProperty('provider_leg');
    expect(result).not.toHaveProperty('delivered_at');
  });

  it('does not reinterpret a return-label flag as an actual return journey', () => {
    const p = delivered(); p.returnPinIndicator = true;
    expect(parse(p).current_stage).toBe('delivered');
    expect(parse(p).events?.some(event => event.provider_leg === 'return')).toBe(false);
  });

  it('does not treat a future conditional return as an active return leg', () => {
    const p = moving(); p.events[0].cd = 'NEW_CODE';
    p.events[0].descEn = 'Item will be returned to sender unless collected';
    expect(parse(p, MOVING_NUMBER).events?.[0]).not.toHaveProperty('provider_leg');
    expect(canadaPostStage('Item may be returned to sender')).toBeNull();
  });

  it('preserves unknown current return scans without borrowing an older completed stage', () => {
    const p = returning(); p.status = 'NEW_SUMMARY'; p.events[0].cd = 'NEW_CODE'; p.events[0].descEn = 'New native scan'; p.events[0].type = 'Info';
    const result = parse(p, RETURN_NUMBER);
    expect(result.status).toBe('unknown');
    expect(result).not.toHaveProperty('current_stage');
    expect(result.events?.[0]).toMatchObject({ provider_leg: 'return', description: 'New native scan' });
  });
});

describe('Canada Post clock and estimate boundaries', () => {
  it('orders explicit instants across offsets with stable ties', () => {
    const p = moving(); p.events[0].datetime = { date: '2026-03-15', time: '10:00:00', zoneOffset: '-05:00' };
    p.events[1].datetime = { date: '2026-03-15', time: '09:00:00', zoneOffset: '-07:00' };
    expect(parse(p, MOVING_NUMBER).events?.map(event => event.provider_code)).toEqual(['1302', '0175']);
  });

  it('retains an offsetless local clock and source order without inventing UTC', () => {
    const p = moving(); delete p.events[0].datetime.zoneOffset; p.events[1].datetime.date = '2026-03-25';
    const result = parse(p, MOVING_NUMBER);
    expect(result).toMatchObject({ last_update: null, last_update_local: '2026-03-15T22:41:00' });
    expect(result.events?.[0]).toMatchObject({ provider_code: '0175', local_time: '2026-03-15T22:41:00' });
    expect(result.events?.[0]).not.toHaveProperty('time');
  });

  it.each(['+02:99', '+14:01', '+23:00', '-14:01'])('preserves invalid offset %s rather than accepting normalized time', offset => {
    const p = moving(); p.events[0].datetime.zoneOffset = offset; p.events[1].datetime.date = '2026-03-25';
    const result = parse(p, MOVING_NUMBER);
    expect(result.last_update).toBeNull();
    expect(result.events?.[0]).toMatchObject({ provider_code: '0175', provider_time_text: `2026-03-15 22:41:00 ${offset}` });
    expect(result.events?.[0]).not.toHaveProperty('time');
  });

  it.each([{ date: '2026-02-30', time: '12:00:00', zoneOffset: '-05:00' }, { date: '2026-03-15', time: '24:00:00', zoneOffset: '-05:00' }, { date: '2026-03-15', time: '', zoneOffset: '-05:00' }, {}])('keeps malformed or missing latest clocks unresolved', datetime => {
    const p = moving(); p.events[0].datetime = datetime; p.events[1].datetime.date = '2026-03-25';
    const result = parse(p, MOVING_NUMBER);
    expect(result.last_update).toBeNull();
    expect(result.events?.[0]?.provider_code).toBe('0175');
    expect(result.events?.[0]).not.toHaveProperty('time');
  });

  it.each([42, true, {}, []])('rejects non-string scan clock fields (%j)', value => {
    const p = moving(); p.events[0].datetime.date = value;
    expect(() => parse(p, MOVING_NUMBER)).toThrow(SchemaError);
  });

  it('suppresses stale, malformed, exception and unknown-scan estimates', () => {
    const p = moving(); p.expectedDlvryDateTime.revisedDate = '2026-03-14';
    expect(parse(p, MOVING_NUMBER).expected_delivery).toBeNull();
    p.expectedDlvryDateTime.revisedDate = '2026-02-30';
    expect(parse(p, MOVING_NUMBER).expected_delivery).toBeNull();
    p.expectedDlvryDateTime.revisedDate = '2026-03-20'; p.events[0].cd = '0172'; p.events[0].descEn = 'Item delayed';
    expect(parse(p, MOVING_NUMBER).expected_delivery).toBeNull();
    p.events[0].cd = 'NEW_CODE'; p.events[0].descEn = 'Item in transit';
    expect(parse(p, MOVING_NUMBER).expected_delivery).toBeNull();
  });

  it('rejects malformed estimate types rather than falling back to an older standard', () => {
    const p = moving(); p.expectedDlvryDateTime.revisedDate = 42;
    expect(() => parse(p, MOVING_NUMBER)).toThrow(SchemaError);
    p.expectedDlvryDateTime.revisedDate = null; p.expectedDlvryDateTime.dlvryDate = {};
    expect(() => parse(p, MOVING_NUMBER)).toThrow(SchemaError);
  });
});

describe('Canada Post identity and negative boundaries', () => {
  it.each([[], {}, { items: [] }, [{ pin: NUMBER }], { pin: '0073938000000000' }])('rejects unbound or incorrect detail envelopes (%j)', payload => {
    expect(() => parse(payload)).toThrow(SchemaError);
  });

  it('requires exact returned identities rather than stripping returned separators', () => {
    const p = delivered(); p.pin = '0073938000 999999';
    expect(() => parse(p)).toThrow(SchemaError);
    p.pin = ` ${NUMBER} `; expect(parse(p).status).toBe('delivered');
  });

  it('does not report expired/unknown 004 envelopes or generic errors as definitive absence', () => {
    expect(() => parse({ pin: NUMBER, error: { cd: '004', descEn: 'No PIN History' } })).toThrow(IndeterminateError);
    expect(() => parse({ pin: NUMBER, error: { cd: 'MAINTENANCE' } })).toThrow(IndeterminateError);
    expect(() => parse({ error: { cd: '004' } })).toThrow(SchemaError);
    expect(() => parse({ pin: NUMBER, error: null })).toThrow(SchemaError);
  });

  it('rejects malformed history and flags, while preserving empty history as inconclusive', () => {
    const p = delivered(); p.events = []; expect(() => parse(p)).toThrow(IndeterminateError);
    p.events = [null]; expect(() => parse(p)).toThrow(SchemaError);
    p.events = Array(501).fill(delivered().events[0]); expect(() => parse(p)).toThrow(SchemaError);
    p.events = 'bad'; expect(() => parse(p)).toThrow(SchemaError);
    const flags = delivered(); flags.returnedToSender = 'true'; expect(() => parse(flags)).toThrow(SchemaError);
  });

  it('accepts only one explicit DNC/reference to PIN mapping', () => {
    expect(resolveCanadaPostPin([{ dnc: NOTICE, pin: NUMBER }], NOTICE, 'dnc')).toBe(NUMBER);
    expect(resolveCanadaPostPin([{ refNbr2: REFERENCE, pin: NUMBER }], REFERENCE, 'reference')).toBe(NUMBER);
    expect(() => resolveCanadaPostPin([{ dnc: '000000000000002', pin: NUMBER }], NOTICE, 'dnc')).toThrow(SchemaError);
    expect(() => resolveCanadaPostPin([{ refNbr1: REFERENCE, pin: '000000000000002' }], REFERENCE, 'reference')).toThrow(SchemaError);
    expect(() => resolveCanadaPostPin([{ refNbr1: REFERENCE, pin: NUMBER }, { refNbr1: REFERENCE, pin: NUMBER }], REFERENCE, 'reference')).toThrow(IndeterminateError);
    expect(() => resolveCanadaPostPin([], NOTICE, 'dnc')).toThrow(IndeterminateError);
    expect(() => resolveCanadaPostPin([{ dnc: NOTICE, error: { cd: '004', descEn: 'No PIN History' } }], NOTICE, 'dnc')).toThrow(IndeterminateError);
  });
});

describe('Canada Post bounded native lookup', () => {
  it('requests PIN detail directly with the public credential and context signal', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(delivered()));
    const result = await new CanadaPostTracker({ fetcher }).fetch(NUMBER, { budgetMs: 2000 });
    expect(result).toMatchObject({ status: 'delivered', tracking_source: 'structured-web-response', tracking_url: canadaPostTrackingUrl(NUMBER) });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toBe(`https://www.canadapost-postescanada.ca/track-reperage/rs/track/json/package/${NUMBER}/detail`);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Basic Og==', Accept: 'application/json, text/plain, */*' }, redirect: 'error', cache: 'no-store' });
    expect(fetcher.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([['dnc', NOTICE, 'dncs'], ['reference', REFERENCE, 'refNbrs']])('resolves a %s before exact PIN detail', async (kind, input, parameter) => {
    const summary = kind === 'dnc' ? { dnc: input, pin: NUMBER } : { refNbr1: input, pin: NUMBER };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([summary])).mockResolvedValueOnce(Response.json(delivered()));
    const result = await new CanadaPostTracker({ fetcher }).fetch(input);
    expect(result.canonical_tracking_number).toBe(NUMBER);
    expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get(parameter)).toBe(input);
    expect(String(fetcher.mock.calls[1]![0])).toContain(`/${NUMBER}/detail`);
  });

  it('does not follow an unbound alias or accept a mismatching detail PIN', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([{ refNbr1: '0000000000002', pin: NUMBER }]));
    await expect(new CanadaPostTracker({ fetcher }).fetch(REFERENCE)).rejects.toBeInstanceOf(SchemaError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(Response.json([{ refNbr1: REFERENCE, pin: NUMBER }])).mockResolvedValueOnce(Response.json({ ...delivered(), pin: MOVING_NUMBER }));
    await expect(new CanadaPostTracker({ fetcher }).fetch(REFERENCE)).rejects.toBeInstanceOf(SchemaError);
  });

  it('stops before a second alias request after budget expiry', async () => {
    let elapsed = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      elapsed = 100; return Response.json([{ dnc: NOTICE, pin: NUMBER }]);
    });
    await expect(new CanadaPostTracker({ fetcher }).fetch(NOTICE, { budgetMs: 50 })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetcher).toHaveBeenCalledTimes(1); now.mockRestore();
  });

  it('respects pre-aborted caller signals and rejects invalid numbers before transport', async () => {
    const fetcher = vi.fn<typeof fetch>(); const controller = new AbortController(); controller.abort();
    await expect(new CanadaPostTracker({ fetcher }).fetch(NUMBER, { signal: controller.signal })).rejects.toBeTruthy();
    await expect(new CanadaPostTracker({ fetcher }).fetch('RR000000019CA')).rejects.toBeInstanceOf(TypeError);
    expect(fetcher).not.toHaveBeenCalled();
    expect(normalizeCanadaPostNumber('rr 000000005 ca')).toBe('RR000000005CA');
    expect(canadaPostLookupKind(NUMBER)).toBe('pin'); expect(canadaPostLookupKind(NOTICE)).toBe('dnc');
    expect(canadaPostLookupKind(REFERENCE)).toBe('reference');
  });

  it.each([404, 410, 403, 429])('keeps HTTP %s failures out of the parcel-negative path', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream failure', { status }));
    try { await new CanadaPostTracker({ fetcher }).fetch(NUMBER); expect.fail('expected failure'); }
    catch (error) { expect(carrierErrorKind(error)).toBe([404, 410].includes(status) ? 'transport' : status === 403 ? 'challenge' : 'rate_limited'); }
  });

  it('rejects malformed JSON and cancels oversized streams', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('<html>not tracking JSON</html>'));
    await expect(new CanadaPostTracker({ fetcher }).fetch(NUMBER)).rejects.toBeInstanceOf(SchemaError);
    const cancel = vi.fn(); const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_000_001)); }, cancel });
    fetcher.mockResolvedValueOnce(new Response(body));
    await expect(new CanadaPostTracker({ fetcher }).fetch(NUMBER)).rejects.toThrow('large response');
    expect(cancel).toHaveBeenCalled();
  });

  it('recognizes full history but leaves no-history errors inconclusive', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(delivered())).mockResolvedValueOnce(Response.json({ pin: NUMBER, error: { cd: '004', descEn: 'No PIN History' } }, { status: 206 }));
    const native = adapter(environment(fetcher));
    expect(await native.recognize!(NUMBER)).toEqual({ known: true, lastActivityAt: '2026-03-14T13:00:34.000Z' });
    await expect(native.recognize!(NUMBER)).rejects.toBeInstanceOf(IndeterminateError);
    expect(await native.recognize!('unaccepted')).toEqual({ known: false });
  });

  it('uses a pathname tracking link rather than a legacy hash route', () => {
    const url = new URL(canadaPostTrackingUrl(NUMBER)); expect(url.pathname).toBe('/track-reperage/en/search');
    expect(url.searchParams.get('searchFor')).toBe(NUMBER); expect(url.hash).toBe('');
  });
});
