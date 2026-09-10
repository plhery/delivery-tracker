import { afterEach, describe, expect, it, vi } from 'vitest';
import observed from './fixtures/auditedTrackingHistory.json';
import { intuitiveHistoryTranslations } from './fixtures/intuitiveHistoryTranslations';
import { replayAuditedScan } from '../test/replayTrackingHistory';
import { buildEvents } from './trackingSync';

// OBSERVED source rows remain an independent test suite. Every row below is
// GENERATED wording; provider codes/categories are held constant on purpose.
// A contradictory real scan should supersede that translation, with a note
// on its fixture entry, rather than changing the observed regression case.
const cases = observed.flatMap((source) => {
  const translation = intuitiveHistoryTranslations.find((row) => row.derivedFrom === source.description);
  return Object.entries(translation?.translations ?? {}).map(([language, description]) => ({
    source, language, description, from: translation!.sourceLanguage, provider: source.provider,
  }));
});

afterEach(() => vi.restoreAllMocks());

describe('intuitive translations of all audited history cases', () => {
  it('keeps every observed case covered in the three other languages', () => {
    expect(cases).toHaveLength(observed.length * 3);
    expect(new Set(intuitiveHistoryTranslations.map((row) => row.derivedFrom)).size)
      .toBe(intuitiveHistoryTranslations.length);
    expect(new Set(intuitiveHistoryTranslations.map((row) => row.derivedFrom)))
      .toEqual(new Set(observed.map((row) => row.description)));
    for (const row of intuitiveHistoryTranslations) {
      expect(row.provenance).toBe('intuitive-translation');
      expect(Object.keys(row.translations).sort())
        .toEqual(['en', 'fr', 'de', 'it'].filter((language) => language !== row.sourceLanguage).sort());
    }
  });

  it.each(cases)('[generated $from → $language] $provider: $description', async ({ source, description }) => {
    const result = await replayAuditedScan(source, description);
    const rows = buildEvents({ id: 'synthetic-package', carrier: source.provider }, result);
    expect(rows[0]?.stage).toBe(source.expected);
  });
});
