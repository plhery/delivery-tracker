/*
 * Refreshes packages/carriers/providers/coverage.json from live lookups.
 *
 *   node packages/carriers/scripts/coverage-probe.mjs probe <cases.json> <results.jsonl>
 *   node packages/carriers/scripts/coverage-probe.mjs summarize <results.jsonl> [--write]
 *
 * cases.json lists public references: [{ "carrier": "usps", "number": "…",
 * "postcode": null, "reference": 0 }]. `reference` is the index in the
 * carrier's coverage.json references (0, the default, is the table's comparison
 * reference). Keep cases and results outside the repository: results hold no
 * numbers or event text, but cases do.
 *
 * `probe` asks the carrier's adapter and every universal provider separately
 * and appends one record per source, so a recheck of a failed source can be
 * appended to the same file (the last record wins). It needs the browser
 * service for 17TRACK and Postal Ninja (COVERAGE_PROBE_TRAWL_URL, for example
 * a tunnel to production's TRAWL) and a Chromium for Ship24's recovery
 * (TRACKING_CHROMIUM_PATH). COVERAGE_PROBE_SOURCES=Ship24,UPU limits the sources.
 *
 * `summarize` prints the results with suggested grades; `--write` stores the
 * provider results in coverage.json. Review the diff before committing: mark
 * other carriers' parcels (`wrong_carrier`, see the reported names), refused
 * formats and stale references by hand, then regenerate the tables with
 * coverage-tables.mjs. The direct columns stay as written.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const coveragePath = path.join(repositoryRoot, 'packages', 'carriers', 'providers', 'coverage.json');
const PROVIDERS = ['Ship24', 'ParcelsApp', '17TRACK', 'Postal Ninja', 'UPU'];
const DAY = 86_400_000;
const INCONCLUSIVE = new Set(['error', 'blocked', 'unverified']);
const [command, ...args] = process.argv.slice(2);

function probe([cases, results]) {
  if (!cases || !results) throw new Error('Usage: coverage-probe.mjs probe <cases.json> <results.jsonl>');
  const result = spawnSync('npx', ['vitest', 'run', '--config', 'packages/carriers/scripts/coverage-probe.config.ts'], {
    cwd: repositoryRoot, stdio: 'inherit',
    env: { ...process.env, COVERAGE_PROBE_CASES: path.resolve(cases), COVERAGE_PROBE_OUT: path.resolve(results) },
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

/** The coverage.json cell for a record, with a suggested partial grade against the reference's other results. */
function cell(record, peers) {
  if (record.outcome !== 'history') return record.outcome;
  if (record.source === 'UPU') return record.rows;
  const histories = peers.filter((peer) => peer.outcome === 'history' && peer.source !== 'UPU' && peer.source !== 'direct');
  const most = Math.max(...histories.map((peer) => peer.rows));
  const newest = Math.max(...histories.map((peer) => Date.parse(peer.latest ?? '') || 0));
  const reasons = [
    record.rows * 3 <= most && histories.length > 1 ? 'a third of the rows or fewer' : null,
    record.undated * 2 > record.rows ? 'undated rows' : null,
    newest - (Date.parse(record.latest ?? '') || 0) > DAY ? 'stops early' : null,
  ].filter(Boolean);
  return reasons.length ? { rows: record.rows, partial: reasons.join(', ') } : record.rows;
}

const text = (value) => typeof value === 'number' ? `✓ ${value}` : typeof value === 'object' ? `✓ ${value.rows}, partial (${value.partial})` : value;

function summarize([results, flag]) {
  if (!results) throw new Error('Usage: coverage-probe.mjs summarize <results.jsonl> [--write]');
  const latest = new Map();
  for (const line of readFileSync(results, 'utf8').split('\n').filter(Boolean)) {
    const record = JSON.parse(line);
    latest.set(`${record.carrier}|${record.reference}|${record.source}`, record);
  }
  const groups = new Map();
  for (const record of latest.values()) {
    const key = `${record.carrier}|${record.reference}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'));
  for (const [key, records] of groups) {
    const [carrier, reference] = key.split('|');
    const cells = Object.fromEntries(records.filter((record) => record.source !== 'direct').map((record) => [record.source, cell(record, records)]));
    const direct = records.find((record) => record.source === 'direct');
    const reported = [...new Set(records.flatMap((record) => record.reported ?? []))];
    console.log(`${carrier} #${reference}: direct ${direct ? text(cell(direct, [direct])) : '·'} | ${PROVIDERS.map((source) =>
      `${source} ${cells[source] === undefined ? '·' : text(cells[source])}`).join(' | ')}${reported.length ? ` | reported ${reported.join(', ')}` : ''}`);
    if (flag !== '--write') continue;
    let entry = coverage.carriers.find((item) => item.carrier === carrier);
    if (!entry) {
      entry = { carrier, direct: 'Not tested', sample: 'Not tested', references: [] };
      coverage.carriers.push(entry);
    }
    const index = Number(reference);
    while (entry.references.length <= index) entry.references.push({ note: 'Added by the probe', results: {} });
    const stored = entry.references[index].results;
    for (const [source, value] of Object.entries(cells)) {
      // A failed lookup (no browser service, a challenge) says less than a stored answer.
      if (INCONCLUSIVE.has(value) && stored[source] !== undefined && !INCONCLUSIVE.has(stored[source])) {
        console.log(`  kept ${source}: ${text(stored[source])}`);
      } else stored[source] = value;
    }
  }
  if (flag === '--write') {
    writeFileSync(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`);
    console.log(`Updated ${path.relative(repositoryRoot, coveragePath)}. Review it, then run node packages/carriers/scripts/coverage-tables.mjs.`);
  }
}

if (command === 'probe') probe(args);
else if (command === 'summarize') summarize(args);
else {
  console.error('Usage: coverage-probe.mjs probe <cases.json> <results.jsonl> | summarize <results.jsonl> [--write]');
  process.exit(1);
}
