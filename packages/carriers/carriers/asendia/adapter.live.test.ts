import { describe, expect, it } from 'vitest';
import { AsendiaA1Tracker } from './adapter';

// Published as an Asendia USA example on
// https://www.trackingmore.com/tracking-status-detail-en-265.html. A1 may
// archive it eventually; supply a current reference through ASENDIA_LIVE_NUMBER
// instead of committing one.
const PUBLISHED_NUMBER = 'AS010501721US';
// Valid shape, never issued.
const UNKNOWN_NUMBER = 'AS000000000US';

describe('Asendia A1 live lookup', () => {
  it('retrieves a matching history through the page configuration', async () => {
    const number = process.env.ASENDIA_LIVE_NUMBER ?? PUBLISHED_NUMBER;
    const started = performance.now();
    const result = await new AsendiaA1Tracker().fetch(number);
    expect(result).toMatchObject({ tracking_source: 'structured-web-response' });
    expect(result.events!.length).toBeGreaterThan(0);
    expect(result.events!.every((event) => /(?:Z|[+-]\d{2}:\d{2})$/.test(event.time ?? ''))).toBe(true);
    expect(performance.now() - started).toBeLessThan(15_000);
  });

  it('reports an unknown number as not found after the key check', async () => {
    await expect(new AsendiaA1Tracker().fetch(UNKNOWN_NUMBER)).rejects.toMatchObject({
      name: 'NotFoundError',
      kind: 'not_found',
      message: 'Asendia could not locate the shipment',
    });
  });
});
