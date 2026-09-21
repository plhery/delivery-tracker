import { describe, expect, it } from 'vitest';
import { PostiTracker } from './adapter';

describe('Posti public tracking', () => {
  it('retrieves the existing public corpus example with a fresh anonymous session', async () => {
    const result = await new PostiTracker().fetch('LR288565359NL');
    expect(result.current_stage).toBe('delivered');
    expect(result.events!.length).toBeGreaterThan(0);
  });

  it('distinguishes a confirmed empty search', async () => {
    await expect(new PostiTracker().fetch('CW000000000FR')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it.skipIf(!process.env.POSTI_TRACKING_NUMBER)('retrieves an authorized privately supplied shipment', async () => {
    const result = await new PostiTracker().fetch(process.env.POSTI_TRACKING_NUMBER!);
    expect(result.status).not.toBe('unknown');
    expect(result.events!.length).toBeGreaterThan(0);
  });
});
