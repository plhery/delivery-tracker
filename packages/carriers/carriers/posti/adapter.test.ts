import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostiTracker, normalizePostiTrackingNumber, parse } from './adapter';
import { postiEventStage, postiStatus } from './status';

const NUMBER = 'CW123456785FR';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const hit = (value: ReturnType<typeof fixture>) => value.data.consumerSearchShipments.hits[0];
const jwt = (expiry = Date.now() / 1000 + 3600) => `fixture.${Buffer.from(JSON.stringify({ exp: expiry })).toString('base64url')}.unsigned`;
const tokens = () => Response.json({ id_token: jwt(), role_tokens: [{ type: 'anonymous', token: jwt() }] });
afterEach(() => vi.restoreAllMocks());

describe('Posti projection', () => {
  it('binds identity, sorts offset timestamps, and selects only declared fields', () => {
    const data = fixture();
    hit(data).events.reverse();
    const result = parse(data, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', weight_kg: 0.5,
      dimensions_text: '25 × 15 × 10 cm', pickup_point: 'Example pickup point, Example city', timezone: 'Europe/Helsinki' });
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'pending', 'ready_for_pickup', 'in_transit', 'in_transit']);
    expect(result.last_update).toBe('2026-01-12T13:00:00Z');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    const capabilities = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities;
    expect(capabilities).toEqual(['history', 'location', 'weight', 'dimensions', 'pickup_point']);
    expect(result.events?.every((event) => event.description && event.time)).toBe(true);
  });

  it('rejects wrong, duplicate and multi-parcel identities', () => {
    expect(() => parse(fixture(), 'CW000000005FR')).toThrow('different or ambiguous');
    const duplicate = fixture();
    duplicate.data.consumerSearchShipments.hits.push(structuredClone(hit(duplicate)));
    expect(() => parse(duplicate, NUMBER)).toThrow('ambiguous');
    const group = fixture();
    hit(group).packages = [{ trackingNumber: 'CW000000005FR', events: [] }];
    expect(() => parse(group, NUMBER)).toThrow('multi-parcel');
  });

  it.each([null, {}, { data: null }, { data: { consumerSearchShipments: { totalHits: 1, hits: [] } } }])(
    'does not classify malformed/partial responses as not found', (data) => {
      expect(() => parse(data, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    },
  );

  it('recognizes only a complete zero-hit response as not found', () => {
    expect(() => parse({ data: { consumerSearchShipments: { totalHits: 0, hits: [] } } }, NUMBER))
      .toThrow(expect.objectContaining({ kind: 'not_found' }));
    const data = fixture(); data.errors = [{ message: 'Resolver unavailable' }];
    expect(() => parse(data, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('keeps pre-advice and unknown codes from inventing progress', () => {
    const data = fixture(); hit(data).events = [];
    hit(data).status = { main: 'ORDER_RECEIVED', subStatus: [] };
    expect(parse(data, NUMBER)).toMatchObject({ status: 'pending', current_stage: 'registered', last_update: null });
    hit(data).status.main = 'NEW_UNKNOWN_CODE';
    expect(parse(data, NUMBER)).toMatchObject({ status: 'unknown', provider_status: 'NEW_UNKNOWN_CODE' });
    expect(parse(data, NUMBER).current_stage).toBeUndefined();
  });

  it('preserves unknown event time and rejects invalid measurements without fabricating values', () => {
    const data = fixture(); hit(data).events = [{ eventDescription: 'New wording', timestamp: '2026-01-12T12:00:00' }];
    hit(data).measurements = { weight: { value: '-1', unit: 'kg' }, length: { value: '20', unit: 'unknown' } };
    const result = parse(data, NUMBER);
    expect(result).toMatchObject({ weight_kg: null, dimensions_text: null, last_update: null });
    expect(result.events?.[0]).toMatchObject({ time: '', stage: 'pending' });
  });

  it('does not confuse collection, customs release and return movement with delivery', () => {
    expect(postiStatus('READY_FOR_PICKUP', [])?.stage).toBe('ready_for_pickup');
    expect(postiStatus('IN_TRANSPORT', ['UNDECLARED'])?.stage).toBe('customs');
    expect(postiStatus('RETURN_IN_TRANSPORT', [])?.stage).toBe('in_transit');
    expect(postiStatus('RETURN_DELIVERED', [])?.stage).toBe('returned');
    expect(postiEventStage('Item has been released for delivery.')).toBe('in_transit');
    expect(postiEventStage('We sent the recipient an email about the item.')).toBe('pending');
  });
});

describe('Posti anonymous transport', () => {
  it('uses two cold requests, then one warm request, with no browser or supplied credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(tokens()).mockResolvedValueOnce(Response.json(fixture()))
      .mockResolvedValueOnce(Response.json(fixture()));
    const tracker = new PostiTracker({ fetcher });
    await tracker.fetch(NUMBER); await tracker.fetch(NUMBER);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][0]).toBe('https://auth-service.posti.fi/api/v1/anonymous_token');
    const request = fetcher.mock.calls[1][1]!;
    const body = JSON.parse(String(request.body));
    expect(body.variables).toEqual({ searchTerms: [NUMBER], locale: 'en' });
    expect(body.query).toContain('type: PUBLIC_SHIPMENTS');
    expect(body.query).not.toMatch(/destination|pinCode|payments|userRole/);
    expect(request.cache).toBe('no-store');
    expect(request.redirect).toBe('error');
    expect(new Headers(request.headers).get('X-Posti-Token')).toMatch(/^Bearer fixture\./);
  });

  it.each(['http', 'graphql'])('refreshes an expired %s session once inside the same lookup', async (mode) => {
    const expired = () => mode === 'http' ? new Response('', { status: 401 })
      : Response.json({ errors: [{ errorType: 'Unauthorized' }] });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(tokens()).mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(tokens()).mockResolvedValueOnce(Response.json(fixture()));
    await expect(new PostiTracker({ fetcher }).fetch(NUMBER)).resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(4);
    const failed = vi.fn<typeof fetch>().mockResolvedValueOnce(tokens()).mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(tokens()).mockResolvedValueOnce(expired());
    await expect(new PostiTracker({ fetcher: failed }).fetch(NUMBER)).rejects.toThrow('session expired');
    expect(failed).toHaveBeenCalledTimes(4);
  });

  it('does not retry throttling, malformed sessions, or ordinary GraphQL failures', async () => {
    for (const response of [new Response('', { status: 429 }), Response.json({ errors: [{ message: 'Unavailable' }] })]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(tokens()).mockResolvedValueOnce(response);
      await expect(new PostiTracker({ fetcher }).fetch(NUMBER)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id_token: 'fixture', role_tokens: [{ type: 'account', token: 'fixture' }] }));
    await expect(new PostiTracker({ fetcher }).fetch(NUMBER)).rejects.toThrow('anonymous session');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation and shares the deadline with token bootstrap', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      abort.abort();
      expect(init?.signal?.aborted).toBe(true);
      return tokens();
    });
    await expect(new PostiTracker({ fetcher }).fetch(NUMBER, { signal: abort.signal })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted();
      return tokens();
    });
    await expect(new PostiTracker({ fetcher: slow, timeoutMs: 20 }).fetch(NUMBER)).rejects.toThrow();
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('normalizes safe identifiers and rejects invalid input before requesting a token', async () => {
    expect(normalizePostiTrackingNumber('cw 123.456-785 fr')).toBe(NUMBER);
    const fetcher = vi.fn<typeof fetch>();
    await expect(new PostiTracker({ fetcher }).fetch('TRACK&admin=1')).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
