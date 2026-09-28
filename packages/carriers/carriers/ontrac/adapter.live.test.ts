import { describe, expect, it } from 'vitest';
import { OntracTracker } from './adapter';

describe('OnTrac live tracking', () => {
  it('keeps the generic missing-resource response inconclusive', async () => {
    await expect(new OntracTracker().fetch('1LS0000000000000')).rejects.toMatchObject({ kind: 'indeterminate' });
  });
  it.skipIf(!process.env.ONTRAC_TRACKING_NUMBER)('returns matching real history', async () => {
    const result = await new OntracTracker().fetch(process.env.ONTRAC_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
});
