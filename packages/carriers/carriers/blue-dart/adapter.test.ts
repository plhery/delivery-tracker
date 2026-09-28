import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BlueDartTracker } from './adapter';
import { parseBlueDart } from './parser';

const NUMBER = '00000000001';
const html = readFileSync(new URL('./fixtures/delivered.html', import.meta.url), 'utf8');
describe('Blue Dart direct tracking', () => {
  it('parses only identity-bound actual scans with Kolkata timestamps', () => {
    const result = parseBlueDart(html, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', delivered_at: '2026-01-03T14:00:00+05:30', timezone: 'Asia/Kolkata' });
    expect(result.events?.map(e => e.stage)).toEqual(['delivered', 'out_for_delivery', 'in_transit']);
    expect(JSON.stringify(result)).not.toMatch(/Private Recipient|private-reference|no information/);
    expect(JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities).toEqual(['history']);
  });
  it('rejects wrong and duplicate summaries and treats an empty shell as schema failure', () => {
    for (const value of [html.replace(NUMBER, '00000000002'), html + html, '<html>Unavailable</html>']) {
      expect(() => parseBlueDart(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
  });
  it('requires the server activation of the no-information panel for a clean negative', () => {
    const reasons = '<div id="reasons" style="display:none"><h4>There is no information on the Waybill/Reference Number/Order Number currently.</h4></div>';
    expect(() => parseBlueDart(reasons, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    for (const script of ['$(function () { $("#reasons").show(); });', "$(function () { $('#reasons').show(); });"]) {
      expect(() => parseBlueDart(`${reasons}<script>${script}</script>`, NUMBER))
        .toThrowError(expect.objectContaining({ kind: 'not_found' }));
    }
    expect(() => parseBlueDart('<script>$("#reasons").show();</script>', NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'schema' }));
  });
  it('does not classify new wording or create an instant from a malformed scan date', () => {
    const value = html.replace('Shipment Arrived At Hub', 'New status').replace('02 Jan 2026', 'invalid date');
    const event = parseBlueDart(value, NUMBER).events?.at(-1);
    expect(event).toMatchObject({ description: 'New status', provider_time_text: 'invalid date 12:00' });
    expect(event).not.toHaveProperty('stage'); expect(event).not.toHaveProperty('time');
  });
  it('preserves the newest unresolved delivery without borrowing an older freshness time', () => {
    const value = html.replace('03 Jan 2026</td><td>14:00', 'date unavailable</td><td>14:00');
    const result = parseBlueDart(value, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', last_update: null });
    expect(result.events?.[0]).toMatchObject({ stage: 'delivered', provider_time_text: 'date unavailable 14:00' });
    expect(result).not.toHaveProperty('delivered_at');
    expect(result.events?.map(e => e.stage)).toEqual(['delivered', 'out_for_delivery', 'in_transit']);
    expect(result.events?.[0]).not.toHaveProperty('time');
    expect(result.events?.[1]?.time).toBe('2026-01-03T08:00:00+05:30');
  });
  it('bounds unresolved date evidence to the scan date cell', () => {
    const date = 'Unresolved '.repeat(10);
    const value = html.replace('03 Jan 2026</td><td>14:00', `${date}</td><td>clock-secret`);
    const event = parseBlueDart(value, NUMBER).events?.[0];
    expect(event?.provider_time_text).toBe(date.trim().slice(0, 64));
    expect(JSON.stringify(event)).not.toMatch(/clock-secret|Private Recipient|private-reference/);
  });
  it('retains an isolated valid clock without creating an instant or freshness date', () => {
    const result = parseBlueDart(html.replace('03 Jan 2026</td><td>14:00', '</td><td>14:00'), NUMBER);
    expect(result.events?.[0]).toMatchObject({ provider_time_text: '14:00' });
    expect(result.events?.[0]).not.toHaveProperty('time');
    expect(result.last_update).toBeNull();
    expect(result.delivered_at).toBeUndefined();
  });
  it('rejects contradictory identity fields and incomplete actual scans', () => {
    const duplicate = html.replace('<tr><th>Status</th>', '<tr><th>Waybill No</th><td>00000000002</td></tr><tr><th>Status</th>');
    const incomplete = html.replace('<td>02 Jan 2026</td><td>12:00</td>', '<td>02 Jan 2026</td>');
    for (const value of [duplicate, incomplete]) {
      expect(() => parseBlueDart(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
  });
  it('uses the read-only result endpoint and passes a bounded abort signal', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(html));
    await new BlueDartTracker({ fetcher }).fetch(NUMBER, { budgetMs: 1000 });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://www.bluedart.com/trackdartresultthirdparty?trackFor=0&trackNo=${NUMBER}`);
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
