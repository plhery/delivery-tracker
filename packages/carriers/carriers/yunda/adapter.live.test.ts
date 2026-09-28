import { describe, expect, it } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { YundaTracker } from './adapter';

const number = process.env.YUNDA_TRACKING_NUMBER;
describe.skipIf(!number)('Yunda anonymous live tracking', () => {
  it('retrieves an identity-bound domestic history in a fresh session', async () => {
    const result = normalizeCarrierResult(await new YundaTracker().fetch(number!));
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.timezone).toBe('Asia/Shanghai');
    expect(result.events?.some(event => event.time)).toBe(true);
  }, 30_000);

  it('keeps an empty synthetic waybill reply indeterminate', async () => {
    await expect(new YundaTracker().fetch('000000000000000')).rejects.toMatchObject({ kind: 'indeterminate' });
  }, 30_000);
});
