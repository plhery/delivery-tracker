/**
 * The detection golden file.
 *
 * What it is: the corpus replayed through the detection engine and frozen as
 * `contracts/fixtures/detection-golden.json`, so the Swift port can assert the
 * same answers without re-deriving them.
 * What it is not: a second detection implementation. Everything here comes from
 * `core/detection` and `numbers.json`.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectCarrierMatch } from '../detection';
import { loadNumberCorpus } from './corpus';

export interface DetectionGoldenEntry {
  readonly input: string;
  readonly carrier: string;
  readonly confidence: 'high' | 'low' | 'none';
  readonly candidates: readonly string[];
}

const testingDirectory = path.dirname(fileURLToPath(import.meta.url));
/** The contract folder is host-owned; the package only writes this one file. */
export const GOLDEN_PATH = path.resolve(
  testingDirectory,
  '..',
  '..',
  '..',
  '..',
  'contracts',
  'fixtures',
  'detection-golden.json',
);

/** One entry per distinct input, sorted, so the file is diffable. */
export function buildDetectionGolden(): DetectionGoldenEntry[] {
  const entries = new Map<string, DetectionGoldenEntry>();
  for (const record of loadNumberCorpus()) {
    if (entries.has(record.number)) continue;
    const match = detectCarrierMatch(record.number);
    entries.set(record.number, {
      input: record.number,
      carrier: match.carrier,
      confidence: match.confidence,
      candidates: match.candidates,
    });
  }
  return [...entries.values()].sort((left, right) => (left.input < right.input ? -1 : 1));
}

export function serializeDetectionGolden(entries: readonly DetectionGoldenEntry[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

export function readDetectionGolden(): DetectionGoldenEntry[] {
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
}

export function writeDetectionGolden(): DetectionGoldenEntry[] {
  const entries = buildDetectionGolden();
  mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, serializeDetectionGolden(entries));
  return entries;
}
