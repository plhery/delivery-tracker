import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLSGermanyTracker } from './glsGermany';

const NUMBER = '12345678901';
function parcel(tuNo = NUMBER) {
  return {
    tuNo,
    progressBar: { statusInfo: 'DELIVERED', statusText: 'Delivered' },
    owners: [{ type: 'REQUEST', code: 'DE01' }],
    addresses: [{ name: 'PRIVATE RECIPIENT', street: 'PRIVATE STREET' }],
    history: [
      { date: '08-Sep-2026', time: '09:00', evtDscr: 'The parcel has been delivered.',
        address: { countryName: 'Germany', city: 'Berlin', street: 'PRIVATE STREET' } },
      { date: '07-Sep-2026', time: '10:00', evtDscr: 'The parcel has reached the final parcel center.' },
    ],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('GLS Germany', () => {
  it('resolves the Track ID then uses the five-digit postcode and verifies the detail identity', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel()] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(parcel())));
    const result = await new GLSGermanyTracker().fetch('AB12CD34', '01067');
    expect(result).toMatchObject({ status: 'delivered', timezone: 'Europe/Berlin', expected_delivery: null });
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'in_transit']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    const detail = new URL(String(fetcher.mock.calls[1][0]));
    expect(detail.pathname).toContain(`/rstt028/${NUMBER}`);
    expect(detail.searchParams.get('postalCode')).toBe('01067');
    expect(detail.searchParams.get('tuOwnerCode')).toBe('DE01');
  });

  it('rejects a different detail shipment', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel()] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(parcel('99999999999'))));
    await expect(new GLSGermanyTracker().fetch(NUMBER, '10115')).rejects.toThrow('different shipment');
  });

  it('rejects a different overview before sending the postcode', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel('99999999999')] })));
    await expect(new GLSGermanyTracker().fetch(NUMBER, '10115')).rejects.toThrow('different shipment');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['', '8000', '123456', 'ABCDE'])('rejects invalid postcode %s before the network request', async (postcode) => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(new GLSGermanyTracker().fetch(NUMBER, postcode)).rejects.toThrow('5-digit recipient postcode');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('recognizes the official expired-number response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ lastError: 'E000' }), { status: 404 }));
    await expect(new GLSGermanyTracker().fetch(NUMBER, '10115')).rejects.toMatchObject({ name: 'GLSGermanyTrackingError', status: 404 });
  });

  it.each([403, 429, 503])('keeps HTTP %i visible as an upstream error', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
    await expect(new GLSGermanyTracker().fetch(NUMBER, '10115')).rejects.toMatchObject({ name: 'UpstreamHttpError', status });
  });
});
