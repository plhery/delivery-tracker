import { afterEach, describe, expect, it, vi } from 'vitest';
import history from './fixtures/auditedTrackingHistory.json';
import { buildEvents } from './trackingSync';
import { replayAuditedScan } from '../test/replayTrackingHistory';

// OBSERVED: source descriptions/codes from the audit. Reconstructed envelopes,
// numbers and timestamps remain synthetic; see replayTrackingHistory.ts.

afterEach(() => vi.restoreAllMocks());

describe('anonymized audited tracking histories', () => {
  it.each(history)('[observed] $provider: $description ($code)', async (scan) => {
    const parsed = await replayAuditedScan(scan);
    const rows = buildEvents({ id: 'synthetic-package', carrier: scan.provider }, parsed);
    expect(rows[0]?.stage).toBe(scan.expected);
  });
});
