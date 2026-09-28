import { describe, expect, it } from 'vitest';
import { OntracTracker } from './adapter';

describe('OnTrac live tracking', () => {
  it('returns a structured negative for an unknown identifier', async () => {
    await expect(new OntracTracker().fetch('1LS0000000000000')).rejects.toMatchObject({ kind: 'not_found' });
  });
  it.skipIf(!process.env.ONTRAC_TRACKING_NUMBER)('returns matching real history', async () => {
    const result = await new OntracTracker().fetch(process.env.ONTRAC_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
});
