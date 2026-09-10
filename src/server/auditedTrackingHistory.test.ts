import { afterEach, describe, expect, it, vi } from 'vitest';
import history from './fixtures/auditedTrackingHistory.json';
import { buildEvents } from './trackingSync';
import { event } from './universalTrackingResult';
import { replayAuditedScan } from '../test/replayTrackingHistory';

const TIME = '2026-01-01T12:00:00Z';
// OBSERVED: source descriptions/codes from the audit. Reconstructed envelopes,
// numbers and timestamps remain synthetic; see replayTrackingHistory.ts.

afterEach(() => vi.restoreAllMocks());

describe('anonymized audited tracking histories', () => {
  // GENERATED boundaries around the observed customs labels, not captured scans.
  it('does not turn negated customs release into completed clearance', () => {
    expect(event(TIME, 'Customs not cleared')?.stage).toBe('customs');
    expect(event(TIME, 'Customs clearance not completed')?.stage).toBe('customs');
    expect(event(TIME, 'Carrier-specific wording')?.stage).toBe('pending');
  });
  it.each(history)('[observed] $provider: $description ($code)', async (scan) => {
    const parsed = await replayAuditedScan(scan);
    const rows = buildEvents({ id: 'synthetic-package', carrier: scan.provider }, parsed);
    expect(rows[0]?.stage).toBe(scan.expected);
  });
});
