import { describe, expect, it } from 'vitest';
import fixture from './fixtures/delivered.json';
import { normalizeSfExpressNumber, parse } from './parser';
import { sfExpressEventStatus, sfExpressSummaryStatus } from './status';

const NUMBER = 'SF0000000000001';
const copy = () => structuredClone(fixture);

describe('SF Express public route parsing', () => {
  it('retains matched historical wall times without inventing a timezone', () => {
    const result = parse(copy(), NUMBER);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_status_text: 'Delivered',
      last_update: null, last_update_local: '2026-01-08T11:20:00', expected_delivery: null });
    expect(result.events).toHaveLength(6);
    expect(result.events?.[0]).toEqual({ local_time: '2026-01-08T11:20:00', description: 'Delivered', provider_code: '80', stage: 'delivered' });
    expect(result.events?.[1]?.stage).toBe('out_for_delivery');
    expect(result.events?.every((event) => event.time === undefined)).toBe(true);
    expect(result.delivered_at).toBeUndefined();
    expect(result.timezone).toBeUndefined();
  });

  it('normalizes only supported public number formats', () => {
    expect(normalizeSfExpressNumber('sf 0000000000001')).toBe(NUMBER);
    expect(normalizeSfExpressNumber('1234-5678-9012')).toBe('123456789012');
    for (const value of ['', 'SF123', '1234567890123', 'SF0000000000001/other']) {
      expect(() => normalizeSfExpressNumber(value)).toThrow(expect.objectContaining({ kind: 'input_required' }));
    }
  });

  it('requires one independently matching result and does not follow sibling identities', () => {
    const wrong = copy(); wrong.result[0].id = 'SF0000000000002';
    expect(() => parse(wrong, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    const duplicate = copy(); duplicate.result.push(duplicate.result[0]);
    expect(() => parse(duplicate, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    const mixed = copy(); mixed.result.unshift(wrong.result[0]);
    expect(parse(mixed, NUMBER).events).toHaveLength(6);
    expect(() => parse({ ...fixture, result: [] }, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('keeps verification failures and server errors distinct from unknown shipments', () => {
    expect(() => parse({ code: 1, result: null, detailMessage: 'Captcha  verification failure' }, NUMBER))
      .toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => parse({ code: 70000, result: null }, NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => parse({ code: 60000, result: null, detailMessage: '运单路由查询被管控' }, NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => parse({ code: 500, result: null }, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    for (const value of [null, [], {}, { ...fixture, success: false }, { ...fixture, result: [null] }]) {
      expect(() => parse(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('validates calendars, history shape and operation codes', () => {
    for (const scanDateTime of ['2026-02-30 10:00:00', '2026-01-02 25:00:00', '', '2026-01-01T00:00:00Z']) {
      const value = copy(); value.result[0].routes[0].scanDateTime = scanDateTime;
      expect(() => parse(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    for (const routes of [[], [null], [{ ...fixture.result[0].routes[0], opCode: '' }], [{ ...fixture.result[0].routes[0], remark: '' }]]) {
      expect(() => parse({ ...fixture, result: [{ ...fixture.result[0], routes }] }, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('does not turn warehouse dispatch, redirects, returns or ambiguous codes into delivery', () => {
    expect(sfExpressEventStatus('202', '')).toMatchObject({ status: 'in_transit' });
    expect(sfExpressEventStatus('626', '')).toMatchObject({ status: 'in_transit' });
    expect(sfExpressEventStatus('8000', '4')).toMatchObject({ status: 'exception', stage: 'returned' });
    expect(sfExpressEventStatus('8000', '')).toBeUndefined();
    expect(sfExpressEventStatus('8000', '__proto__')).toBeUndefined();
    expect(sfExpressSummaryStatus('__proto__', false)).toBeUndefined();
    expect(sfExpressSummaryStatus('4', true)).toMatchObject({ stage: 'returned' });
    expect(sfExpressSummaryStatus('99', true)).toMatchObject({ stage: 'in_transit' });
    const value = copy(); value.result[0].signed = false;
    value.result[0].routes = [{ ...value.result[0].routes[0], opCode: 'NEW_CODE', remark: 'Unrecognized movement' }];
    expect(parse(value, NUMBER)).toMatchObject({ status: 'unknown', last_status_text: 'Unrecognized movement' });
    expect(parse(value, NUMBER).events?.[0].stage).toBeUndefined();
    value.result[0].expressState = '99';
    expect(parse(value, NUMBER).status).toBe('in_transit');
    value.result[0].routes[0].opCode = '204';
    expect(parse(value, NUMBER).status).toBe('out_for_delivery');
  });

  it('drops proof-access rows and personal detail fields', () => {
    const value = copy();
    value.result[0].routes[0].remark = 'Collected <a id="opr_phone" href="tel:000000000">Synthetic Person</a><script>private()</script>';
    value.result[0].routes[5].remark = 'Delivered to Synthetic Person';
    value.result[0].routes.push({ ...value.result[0].routes[5], remark: '<a href="https://example.invalid/private">AWB Info &amp; POD</a>', scanDateTime: '' });
    const result = parse({ ...value, recipient: 'Synthetic Person', proof: 'https://example.invalid/private' }, NUMBER);
    expect(result.events).toHaveLength(6);
    expect(JSON.stringify(result)).not.toMatch(/Synthetic Person|private|opr_phone|zoneCode|promiseTime|waybillNo/);
  });

  it('bounds retained and inspected scans, deduplicates exact repeats and sorts like the portal', () => {
    const value = copy(); value.result[0].routes.reverse(); value.result[0].routes.push(value.result[0].routes[0]);
    expect(parse(value, NUMBER).events).toHaveLength(6);
    value.result[0].routes = Array.from({ length: 110 }, (_, i) => ({ ...value.result[0].routes[0], remark: `Movement ${i}`, opCode: '31' }));
    expect(parse(value, NUMBER).events).toHaveLength(100);
    value.result[0].routes = Array.from({ length: 501 }, () => value.result[0].routes[0]);
    expect(() => parse(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
});
