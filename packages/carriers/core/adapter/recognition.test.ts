import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NotFoundError, UpstreamHttpError } from '../errors';
import { REGISTRY } from '../../generated/registry';
import { NOOP_RECORDER } from '../telemetry';
import { AdapterRegistry, accepted, recognizeFromLookup } from '.';

const carriersDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'carriers');

describe('recognition from a plain lookup', () => {
  it('reads a result as known, a positive not-found as unknown, and rethrows the rest', async () => {
    await expect(recognizeFromLookup(async () => ({
      status: 'in_transit', events: [
        { time: '2026-09-08T10:00:00Z', description: 'Sorted' }, { time: '2026-09-09T08:00:00+02:00', description: 'Out' },
      ],
    }))).resolves.toEqual({ known: true, lastActivityAt: '2026-09-09T06:00:00.000Z' });
    await expect(recognizeFromLookup(async () => ({ status: 'unknown', events: [] }))).resolves.toEqual({ known: false, lastActivityAt: null });
    // "Tracking information received" for any number is no evidence.
    await expect(recognizeFromLookup(async () => ({ status: 'pending', events: [] }))).resolves.toEqual({ known: false, lastActivityAt: null });
    await expect(recognizeFromLookup(async () => ({ status: 'delivered', events: [], last_update: '2026-09-09T08:00:00Z' })))
      .resolves.toEqual({ known: true, lastActivityAt: '2026-09-09T08:00:00.000Z' });
    await expect(recognizeFromLookup(async () => { throw new NotFoundError('Carrier'); })).resolves.toEqual({ known: false });
    // A form of number the adapter does not accept is unknown without a request.
    let asked = false;
    const reject = () => accepted(() => { throw new TypeError('Unsupported number'); });
    await expect(recognizeFromLookup(async () => { asked = true; return { status: 'delivered' }; }, reject)).resolves.toEqual({ known: false });
    expect(asked).toBe(false);
    // Any other TypeError is a failure, not an answer.
    await expect(recognizeFromLookup(async () => { throw new TypeError('Cannot read properties of null'); })).rejects.toThrow(TypeError);
    // Day-first carrier dates are no instant: the parcel is known, its activity undated.
    await expect(recognizeFromLookup(async () => ({ status: 'in_transit', events: [{ time: '27/09/2026 08:15', description: 'Sorted' }] })))
      .resolves.toEqual({ known: true, lastActivityAt: null });
    await expect(recognizeFromLookup(async () => { throw new UpstreamHttpError('Carrier', 503); })).rejects.toThrow();
  });
});

describe('catalog recognition', () => {
  it('is declared only by carriers whose adapter can recognize a number', () => {
    const registry = new AdapterRegistry(REGISTRY, { trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    const declared = readdirSync(carriersDirectory).filter((id) => {
      try {
        return Boolean(JSON.parse(readFileSync(path.join(carriersDirectory, id, 'carrier.json'), 'utf8')).tracking?.recognition);
      } catch { return false; }
    });
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((id) => typeof registry.for(id)?.recognize !== 'function')).toEqual([]);
  });
});
