import { afterEach, describe, expect, it, vi } from 'vitest';
import observed from './fixtures/auditedTrackingHistory.json';
import { intuitiveHistoryTranslations } from './fixtures/intuitiveHistoryTranslations';
import { replayAuditedScan } from '../test/replayTrackingHistory';
import { buildEvents } from './trackingSync';

// OBSERVED source rows remain an independent test suite. Every row below is
// GENERATED wording; provider codes/categories are held constant on purpose.
// A contradictory real scan should supersede that translation, with a note
// on its fixture entry, rather than changing the observed regression case.
// Every observed case is translated into each of these languages but its own.
const LANGUAGES = ['en', 'fr', 'de', 'it'];
const targets = (sourceLanguage?: string) => LANGUAGES.filter((language) => language !== sourceLanguage);
const translationOf = (description: string) =>
  intuitiveHistoryTranslations.find((row) => row.derivedFrom === description);
const cases = observed.flatMap((source) => {
  const translation = translationOf(source.description);
  return Object.entries(translation?.translations ?? {}).map(([language, description]) => ({
    source, language, description, from: translation!.sourceLanguage, provider: source.provider,
  }));
});

afterEach(() => vi.restoreAllMocks());

describe('intuitive translations of all audited history cases', () => {
  it('keeps every observed case covered in the other languages', () => {
    expect(cases).toHaveLength(observed.reduce((count, source) =>
      count + targets(translationOf(source.description)?.sourceLanguage).length, 0));
    expect(new Set(intuitiveHistoryTranslations.map((row) => row.derivedFrom)).size)
      .toBe(intuitiveHistoryTranslations.length);
    expect(new Set(intuitiveHistoryTranslations.map((row) => row.derivedFrom)))
      .toEqual(new Set(observed.map((row) => row.description)));
    for (const row of intuitiveHistoryTranslations) {
      expect(row.provenance).toBe('intuitive-translation');
      expect(Object.keys(row.translations).sort()).toEqual(targets(row.sourceLanguage).sort());
    }
  });

  it.each(cases)('[generated $from → $language] $provider: $description', async ({ source, description }) => {
    const result = await replayAuditedScan(source, description);
    const rows = buildEvents({ id: 'synthetic-package', carrier: source.provider }, result);
    expect(rows[0]?.stage).toBe(source.expected);
  });
});
