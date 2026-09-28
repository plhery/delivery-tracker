import { describe, expect, it } from 'vitest';
import { CorreiosTracker } from './adapter';

describe('Correios live tracking', () => {
  it.skipIf(!process.env.CORREIOS_BR_TRACKING_NUMBER)('returns matching real history through local OCR', async () => {
    const tracker = new CorreiosTracker();
    try {
      const result = await tracker.fetch(process.env.CORREIOS_BR_TRACKING_NUMBER!);
      expect(result.events?.length).toBeGreaterThan(0);
    } finally { await tracker.close(); }
  });
});
