import { describe, expect, it } from 'vitest';
import { BlueDartTracker } from './adapter';

describe('Blue Dart live tracking', () => {
  it('recognizes the explicit no-information result', async () => {
    await expect(new BlueDartTracker().fetch('00000000000')).rejects.toMatchObject({ kind: 'not_found' });
  });
  it.skipIf(!process.env.BLUE_DART_TRACKING_NUMBER)('returns matching real scans', async () => {
    expect((await new BlueDartTracker().fetch(process.env.BLUE_DART_TRACKING_NUMBER!)).events?.length).toBeGreaterThan(0);
  });
});
