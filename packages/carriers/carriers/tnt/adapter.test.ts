import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, normalizeTntFranceNumber, parseTntFranceResponse, TntFranceTracker } from './adapter';

const NUMBER = '1000000000000001';
const fixture = () => readFileSync(new URL('./fixtures/registered.html', import.meta.url), 'utf8');

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

  it('does not call the domestic endpoint for international numbers', async () => {
    expect(() => normalizeTntFranceNumber('123456789')).toThrow('16-digit');
    const fetcher = vi.fn<typeof fetch>();
    const tracker = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    await expect(tracker.recognize!('123456789')).resolves.toEqual({ known: false });
    await expect(tracker.track({ number: '123456789' })).rejects.toMatchObject({ kind: 'input_required' });
    expect(fetcher).not.toHaveBeenCalled();
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
