/**
 * The detection sweep.
 *
 * What it does: replays every record in `carriers/<id>/numbers.json` through the
 * detection engine and asserts the recorded answer, checks that no second
 * carrier claims a positive record, reports detection rules that still have no
 * sample, requires every carrier overlap to be declared in `collisions.json`,
 * and compares the committed Swift golden file with the computed one.
 *
 * The corpus is a characterization of today's engine. A failure here means
 * detection changed: decide whether that change was intended, then update the
 * records and the golden file (`node packages/carriers/scripts/detection-golden.mjs`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectCarrierMatch,
  isValidMondialRelayBarcode,
  isValidS10TrackingNumber,
  normalizeTrackingNumber,
} from '../detection';
import {
  CARRIERS_DIRECTORY,
  carrierFolders,
  loadNumberCorpus,
  loadNumberCorpusFiles,
  positiveRecords,
  type CorpusRecord,
} from './corpus';
import { buildDetectionGolden, readDetectionGolden, writeDetectionGolden } from './golden';

interface DetectionRule {
  readonly id: string;
  readonly pattern: string;
  readonly confidence: 'high' | 'low';
  readonly checksum?: 's10' | 'mondial-relay';
}

interface CarrierRule {
  readonly carrier: string;
  readonly rule: DetectionRule;
}

const detectionDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'detection');
const collisions: { shape: string; carriers: string[]; reason: string }[] = JSON.parse(
  readFileSync(path.join(detectionDirectory, 'collisions.json'), 'utf8'),
);
const coverageBaseline: { maxUncoveredRules: number } = JSON.parse(
  readFileSync(path.join(detectionDirectory, 'coverage-baseline.json'), 'utf8'),
);

const RULES: CarrierRule[] = carrierFolders().flatMap((carrier) => {
  const definition: { detection?: DetectionRule[] } = JSON.parse(
    readFileSync(path.join(CARRIERS_DIRECTORY, carrier, 'carrier.json'), 'utf8'),
  );
  return (definition.detection ?? []).map((rule) => ({ carrier, rule }));
});

/** The engine's own gate, rule by rule: pattern first, then the checksum. */
function ruleMatches(rule: DetectionRule, value: string): boolean {
  if (!new RegExp(rule.pattern).test(value)) return false;
  if (rule.checksum === 's10') return isValidS10TrackingNumber(value);
  if (rule.checksum === 'mondial-relay') return isValidMondialRelayBarcode(value);
  return true;
}

function matchingRules(input: string): CarrierRule[] {
  const value = normalizeTrackingNumber(input);
  return RULES.filter(({ rule }) => ruleMatches(rule, value));
}

/** Carriers with at least one matching rule, in catalog order. */
function matchingCarriers(input: string): string[] {
  return [...new Set(matchingRules(input).map(({ carrier }) => carrier))];
}

/**
 * The engine stops at a carrier's first matching rule, so a carrier's
 * confidence is that rule's confidence, not the strongest one it owns.
 */
function highConfidenceCarriers(input: string): string[] {
  const matches = matchingRules(input);
  const firstPerCarrier = new Map<string, DetectionRule>();
  for (const { carrier, rule } of matches) if (!firstPerCarrier.has(carrier)) firstPerCarrier.set(carrier, rule);
  return [...firstPerCarrier.entries()]
    .filter(([, rule]) => rule.confidence === 'high')
    .map(([carrier]) => carrier);
}

const records = loadNumberCorpus();
const folders = carrierFolders();

function observed(record: CorpusRecord) {
  const match = detectCarrierMatch(record.number);
  return match.confidence === 'high'
    ? { number: record.number, carrier: match.carrier, confidence: match.confidence }
    : match.confidence === 'low'
      ? {
        number: record.number,
        carrier: match.carrier,
        confidence: match.confidence,
        candidates: match.candidates,
      }
      : { number: record.number, carrier: match.carrier, confidence: match.confidence };
}

function recorded(record: CorpusRecord) {
  const { carrier, confidence } = record.expect;
  return confidence === 'low'
    ? { number: record.number, carrier, confidence, candidates: [...record.expect.candidates] }
    : { number: record.number, carrier, confidence };
}

describe('number corpus', () => {
  it('covers every carrier folder', () => {
    expect(loadNumberCorpusFiles().map((file) => file.carrier)).toEqual(folders);
  });

  it('states a gap for every carrier without a record', () => {
    const unexplained = loadNumberCorpusFiles()
      .filter((file) => file.records.length === 0 && !file.gap)
      .map((file) => file.carrier);
    expect(unexplained).toEqual([]);
  });

  it('keeps every number distinct inside its carrier folder', () => {
    for (const file of loadNumberCorpusFiles()) {
      const normalized = file.records.map((record) => normalizeTrackingNumber(record.number));
      expect(`${file.carrier}: ${new Set(normalized).size}`).toBe(`${file.carrier}: ${normalized.length}`);
    }
  });
});

describe('detection expectations', () => {
  it.each(folders)('%s numbers detect as recorded', (folder) => {
    const forCarrier = records.filter((record) => record.carrier === folder);
    expect(forCarrier.map(observed)).toEqual(forCarrier.map(recorded));
  });

  it('agrees with a rule-by-rule replay of the catalog', () => {
    const drift = records.filter((record) => {
      const high = highConfidenceCarriers(record.number);
      const match = detectCarrierMatch(record.number);
      return match.confidence === 'high'
        ? high.length !== 1 || high[0] !== match.carrier
        : high.length === 1;
    });
    expect(drift.map((record) => record.number)).toEqual([]);
  });

  it('never lets a second carrier claim a positive record', () => {
    const contested = positiveRecords(records)
      .map((record) => ({ record, high: highConfidenceCarriers(record.number) }))
      .filter(({ record, high }) => high.length !== 1 || high[0] !== record.expect.carrier)
      .map(({ record, high }) => `${record.number} → ${high.join(', ')}`);
    expect(contested).toEqual([]);
  });

  it('honours the carriers a negative record rules out', () => {
    const broken: string[] = [];
    for (const record of records) {
      const forbidden = 'not' in record.expect ? record.expect.not ?? [] : [];
      const claimed = matchingCarriers(record.number);
      for (const carrier of forbidden) {
        if (claimed.includes(carrier)) broken.push(`${record.number} still matches ${carrier}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('rule coverage', () => {
  it('keeps the number of rules without a sample at or below the baseline', () => {
    const covered = new Set(records.flatMap((record) => matchingRules(record.number).map(({ rule }) => rule.id)));
    const uncovered = RULES.filter(({ rule }) => !covered.has(rule.id))
      .map(({ carrier, rule }) => `${rule.id} (${carrier}): ${rule.pattern}`);
    if (uncovered.length > 0) {
      console.warn(`Detection rules with no sample number (${uncovered.length}):\n  ${uncovered.join('\n  ')}`);
    }
    expect(uncovered.length).toBeLessThanOrEqual(coverageBaseline.maxUncoveredRules);
  });
});

describe('declared collisions', () => {
  const declared = new Map(collisions.map((entry) => [[...entry.carriers].sort().join(','), entry]));

  it('declares every carrier overlap the corpus produces', () => {
    const undeclared = new Map<string, string>();
    for (const record of records) {
      const carriers = matchingCarriers(record.number).sort();
      if (carriers.length < 2) continue;
      const key = carriers.join(',');
      if (!declared.has(key)) undeclared.set(key, record.number);
    }
    expect([...undeclared].map(([key, number]) => `${key} (e.g. ${number})`)).toEqual([]);
  });

  it('gives every declared collision a shape, carriers and a reason', () => {
    for (const entry of collisions) {
      expect(entry.carriers.length).toBeGreaterThan(1);
      expect(entry.shape.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(0);
      for (const carrier of entry.carriers) expect(folders).toContain(carrier);
    }
    expect(declared.size).toBe(collisions.length);
  });

  it('reports declarations the corpus no longer reaches', () => {
    const seen = new Set(records
      .map((record) => matchingCarriers(record.number).sort().join(','))
      .filter((key) => key.includes(',')));
    const stale = [...declared.keys()].filter((key) => !seen.has(key));
    if (stale.length > 0) console.warn(`Declared collisions with no sample number:\n  ${stale.join('\n  ')}`);
    expect(stale.length).toBeLessThanOrEqual(collisions.length);
  });
});

describe('swift golden file', () => {
  it('matches the committed contracts/fixtures/detection-golden.json', () => {
    if (process.env.UPDATE_DETECTION_GOLDEN) {
      expect(writeDetectionGolden().length).toBe(buildDetectionGolden().length);
      return;
    }
    expect(readDetectionGolden()).toEqual(buildDetectionGolden());
  });
});
