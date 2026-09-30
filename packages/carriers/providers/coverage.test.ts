// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARRIER_CATALOG } from '../generated/catalog';
import { CARRIER_COVERAGE, COVERAGE_SOURCES, coverageProblems, coverageTiers, isHistory, type CoverageCell } from './coverage';
import { orderUniversalSources, universalPlan } from './universal';
import type { UniversalSource } from './shared/result';

const providersDirectory = path.dirname(fileURLToPath(import.meta.url));
const COVERAGE_PATH = path.join(providersDirectory, 'COVERAGE.md');
const AGGREGATORS = COVERAGE_SOURCES.filter((source) => source !== 'UPU');
const catalog = CARRIER_CATALOG as Record<string, { displayName: string }>;

const WORDS: Record<string, string> = {
  no_history: 'No history', summary_only: 'Summary only', sign_in: 'Sign-in', postcode_prompt: 'Postcode prompt',
  wrong_carrier: 'Wrong carrier', refused: 'Refused', error: 'Error', blocked: 'Blocked', unverified: 'Unverified', 'n/a': 'N/A',
};
function cellText(cell: CoverageCell | undefined): string {
  if (typeof cell === 'number') return `✓ ${cell}`;
  if (typeof cell === 'object') return `✓ ${cell.rows}, partial`;
  if (cell === 'history') return '✓';
  return WORDS[cell!];
}

function coverageTable(): string {
  const rows = CARRIER_COVERAGE.map((entry) => {
    const folder = path.join(providersDirectory, '..', 'carriers', entry.carrier);
    const link = existsSync(path.join(folder, 'README.md')) ? 'README.md' : 'carrier.json';
    const name = entry.name ?? catalog[entry.carrier].displayName;
    const results = COVERAGE_SOURCES.map((source) => cellText(entry.references[0].results[source]));
    return `| [${name}](../carriers/${entry.carrier}/${link}) | ${entry.direct} | ${entry.sample} | ${results.join(' | ')} |`;
  });
  return [`| Carrier | Direct support | Direct sample | ${COVERAGE_SOURCES.join(' | ')} |`,
    `| --- | --- | --- | ${COVERAGE_SOURCES.map(() => '---').join(' | ')} |`, ...rows].join('\n');
}

function lookupOrder(): string {
  const tiers = CARRIER_COVERAGE.map((entry) => coverageTiers(entry.carrier)!);
  const totals = AGGREGATORS.map((source) => {
    const known = tiers.filter((tier) => ['full', 'partial'].includes(tier[source])).length;
    const full = tiers.filter((tier) => tier[source] === 'full').length;
    const only = tiers.filter((tier) => AGGREGATORS.every((other) => other === source
      ? ['full', 'partial'].includes(tier[other]) : !['full', 'partial'].includes(tier[other]))).length;
    return `| ${source} | ${known} | ${full} | ${known - full} | ${only} |`;
  });
  const chain = (carrier?: string) => universalPlan({ carriers: [carrier], enablePostalNinja: true }).sources
    .filter((source) => source !== 'UPU').join(' → ');
  const standard = chain();
  const orders = CARRIER_COVERAGE.filter((entry) => chain(entry.carrier) !== standard)
    .map((entry) => `| ${entry.name ?? catalog[entry.carrier].displayName} | ${chain(entry.carrier)} |`);
  return [
    '| Source | Carriers with history | Full | Partial | Only source |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...totals,
    '',
    `With Postal Ninja enabled, carriers without their own order use ${standard}. These carriers have their own:`,
    '',
    '| Carrier | Order |',
    '| --- | --- |',
    ...orders,
  ].join('\n');
}

function replaceBlock(text: string, name: string, content: string): string {
  const start = `<!-- GENERATED:${name} -->`;
  const end = `<!-- /GENERATED:${name} -->`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < from) throw new Error(`COVERAGE.md has no ${name} block`);
  return `${text.slice(0, from + start.length)}\n${content}\n${text.slice(to)}`;
}

describe('coverage evidence', () => {
  it('holds valid results for catalog carriers, each once, with a complete comparison reference', () => {
    const ids = CARRIER_COVERAGE.map((entry) => entry.carrier);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of CARRIER_COVERAGE) {
      expect(catalog[entry.carrier], entry.carrier).toBeDefined();
      expect(coverageProblems(entry), entry.carrier).toEqual([]);
      expect(Object.keys(entry.references[0].results).sort(), entry.carrier).toEqual([...COVERAGE_SOURCES].sort());
      if (entry.name) expect(entry.name).not.toBe(catalog[entry.carrier].displayName);
    }
  });

  it('reports invalid results', () => {
    expect(coverageProblems({ carrier: 'x', direct: '', sample: '', references: [] })).toEqual(['no reference']);
    expect(coverageProblems({ carrier: 'x', direct: '', sample: '', references: [{ results: {
      Ship24: 0, ParcelsApp: 'maybe' as never, UPU: { rows: 2, partial: '' }, Other: 1,
    } as never }] })).toEqual([
      'reference 1: invalid Ship24 result 0',
      'reference 1: invalid ParcelsApp result "maybe"',
      'reference 1: invalid UPU result {"rows":2,"partial":""}',
      'reference 1: unknown source Other',
    ]);
    expect(isHistory('no_history')).toBe(false);
    expect(isHistory({ rows: 1, partial: 'one row' })).toBe(true);
  });

  it('grades each provider from all of a carrier\'s references', () => {
    // The only aggregator with USPS history.
    expect(coverageTiers('usps')).toMatchObject({ '17TRACK': 'full', ParcelsApp: 'empty', Ship24: 'empty', 'Postal Ninja': 'empty' });
    // Label only for one reference.
    expect(coverageTiers('ups')).toMatchObject({ Ship24: 'partial', ParcelsApp: 'full' });
    // 17TRACK held an old parcel but missed a September one the others knew.
    expect(coverageTiers('mrw')).toMatchObject({ '17TRACK': 'partial', Ship24: 'full', ParcelsApp: 'full', 'Postal Ninja': 'full' });
    // A stranger's parcel or a refused format excludes a provider without history.
    expect(coverageTiers('yamato')).toMatchObject({ ParcelsApp: 'excluded', Ship24: 'unknown' });
    expect(coverageTiers('purolator')).toMatchObject({ 'Postal Ninja': 'excluded', ParcelsApp: 'full' });
    // Negatives on a reference too old to say anything.
    expect(coverageTiers('chronopost')).toMatchObject({ Ship24: 'unknown', ParcelsApp: 'unknown' });
    expect(coverageTiers('unknown')).toBeNull();
    expect(coverageTiers(null)).toBeNull();
  });

  it('never leaves a carrier without an aggregator to ask', () => {
    for (const entry of CARRIER_COVERAGE) {
      expect(universalPlan({ carriers: [entry.carrier] }).sources.filter((source) => source !== 'UPU').length, entry.carrier).toBeGreaterThan(0);
    }
  });

  it('keeps the generated tables of COVERAGE.md current', () => {
    const current = readFileSync(COVERAGE_PATH, 'utf8');
    const next = replaceBlock(replaceBlock(current, 'coverage', coverageTable()), 'lookup-order', lookupOrder());
    if (process.env.UPDATE_COVERAGE_TABLES) writeFileSync(COVERAGE_PATH, next);
    else expect(current, 'Run node packages/carriers/scripts/coverage-tables.mjs').toBe(next);
  });
});

describe('coverage-based lookup order', () => {
  const plan = (carrier: string, options: { trackingNumber?: string; enablePostalNinja?: boolean } = {}) =>
    universalPlan({ carriers: [carrier], enablePostalNinja: true, ...options });

  it('asks fuller history first, HTTP before the browser service within a tier', () => {
    expect(plan('usps').sources).toEqual(['17TRACK', 'ParcelsApp', 'Ship24', 'Postal Ninja', 'UPU']);
    expect(plan('ups').sources).toEqual(['ParcelsApp', 'Postal Ninja', '17TRACK', 'Ship24', 'UPU']);
    expect(plan('australia-post').sources.slice(0, 1)).toEqual(['Postal Ninja']);
    expect(plan('spring-gds').sources).toEqual(['Ship24', 'Postal Ninja', 'ParcelsApp', '17TRACK', 'UPU']);
    expect(plan('ups').rank('ParcelsApp')).toBeLessThan(plan('ups').rank('Ship24'));
  });

  it('leaves out excluded providers and Postal Ninja when it is disabled', () => {
    expect(plan('yamato').sources).not.toContain('ParcelsApp');
    expect(plan('australia-post', { enablePostalNinja: false }).sources).toEqual(['ParcelsApp', 'Ship24', '17TRACK', 'UPU']);
  });

  it('keeps UPU last and postal-only, and China Post C/L numbers on 17TRACK first', () => {
    expect(plan('usps', { trackingNumber: '9400100000000000000000' }).sources).not.toContain('UPU');
    expect(plan('china-post', { trackingNumber: 'LZ000000005CN' }).sources[0]).toBe('17TRACK');
    expect(plan('china-post', { trackingNumber: 'LZ000000005CN' }).sources.at(-1)).toBe('UPU');
  });

  it('uses the first carrier with evidence, else the default order', () => {
    expect(universalPlan({ carriers: ['unknown', null, 'usps'] })).toMatchObject({ carrier: 'usps', sources: ['17TRACK', 'ParcelsApp', 'Ship24', 'UPU'] });
    const standard = universalPlan({ carriers: ['unknown'] });
    expect(standard).toMatchObject({ carrier: null, sources: ['ParcelsApp', 'Ship24', '17TRACK', 'UPU'] });
    expect(standard.tier('Ship24')).toBe('unknown');
    expect(standard.rank('Ship24')).toBe(standard.rank('17TRACK'));
  });

  it('keeps every provider when evidence would exclude them all', () => {
    const excluded: Partial<Record<UniversalSource, 'excluded'>> = { Ship24: 'excluded', ParcelsApp: 'excluded', '17TRACK': 'excluded' };
    expect(orderUniversalSources(['ParcelsApp', 'Ship24', '17TRACK', 'UPU'], excluded)).toEqual(['ParcelsApp', 'Ship24', '17TRACK', 'UPU']);
    expect(orderUniversalSources(['ParcelsApp', 'Ship24', '17TRACK', 'UPU'], { Ship24: 'excluded', UPU: 'full' }))
      .toEqual(['ParcelsApp', '17TRACK', 'UPU']);
  });
});
