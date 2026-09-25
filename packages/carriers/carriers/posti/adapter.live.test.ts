import { describe, expect, it } from 'vitest';
import { PostiTracker } from './adapter';

describe('Posti public tracking', () => {
  it('maps the public corpus example, now past Posti\'s retention, to a clean not-found', async () => {
    // Delivered history was returned until 2026-09-24; Posti's own tracker now
    // reports the item as not found too.
    await expect(new PostiTracker().fetch('LR288565359NL')).rejects.toMatchObject({ kind: 'not_found' });
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
