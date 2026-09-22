/*
 * Generates the overview table in packages/carriers/README.md from the carrier
 * folders, between the GENERATED markers. Everything outside the markers is
 * hand-written. `--check` fails when the committed table is stale.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const carriersRoot = path.join(packageRoot, 'carriers');
const providersRoot = path.join(packageRoot, 'providers');
const readmePath = path.join(packageRoot, 'README.md');
const START = '<!-- GENERATED:carriers -->';
const END = '<!-- /GENERATED:carriers -->';

// Editorial prominence order for the overview, not a measured market-share ranking.
// Keep unfamiliar additions alphabetical after these carriers, before unknowns.
const carrierOrder = [
  'dhl', 'ups', 'fedex', 'usps', 'amazon-logistics', 'amazon-shipping',
  'royal-mail', 'swiss-post', 'la-poste', 'dpd', 'dhl-ecommerce',
  'aliexpress', 'china-post', 'ems', 'sf-express',
  'gls-de', 'gls-fr', 'gls-ch', 'hermes-de', 'evri',
  'chronopost', 'mondial-relay', 'inpost', 'spring-gds',
  'canada-post', 'australia-post', 'japan-post', 'india-post',
  'poste-italiane', 'correos-spain', 'bpost', 'austrian-post', 'postnord',
  'tnt', 'aramex', 'yunexpress', 'four-px', 'yanwen',
  'j-and-t', 'jd-logistics', 'zto', 'yto', 'yunda', 'sto', 'yamato',
  'correios-br', 'singapore-post', 'hongkong-post', 'korea-post',
  'planzer', 'quickpac', 'dpd-fr', 'parcelforce', 'purolator', 'ontrac',
  'delhivery', 'blue-dart', 'dtdc', 'ninja-van',
  'packeta', 'poczta-polska', 'bring-posten', 'posti', 'an-post',
  'ctt', 'ctt-express', 'brt', 'seur', 'correos-express', 'mrw', 'nacex',
  'colis-prive', 'relais-colis', 'paack', 'asendia', 'landmark-global',
  'nz-post', 'pos-malaysia', 'thailand-post', 'ukrposhta',
  'estafeta', 'correos-chile', 'the-courier-guy',
  'geodis', 'dachser', 'old-dominion', 'swiss-post-cargo', 'postlogistics',
  'hermes', 'heppner', 'ciblex', 'c-chez-vous', 'colisweb', 'delivengo',
  'uniuni', 'speedx', 'gofo', 'ecoscooting', 'tipsa', 'canpar', 'spee-dee',
  'sunyou', 'shipup',
];
const carrierRank = new Map(carrierOrder.map((id, index) => [id, index]));
carrierRank.set('intl-post', Infinity);
carrierRank.set('unknown', Infinity);

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function folders(root) {
  return existsSync(root)
    ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [];
}

const carrierIds = folders(carriersRoot).sort((a, b) =>
  (carrierRank.get(a) ?? carrierOrder.length) - (carrierRank.get(b) ?? carrierOrder.length)
  || a.localeCompare(b));
const rows = carrierIds.map((id) => {
  const folder = path.join(carriersRoot, id);
  const carrier = readJson(path.join(folder, 'carrier.json')) ?? {};
  const numbers = readJson(path.join(folder, 'numbers.json')) ?? { records: [] };
  const statuses = readJson(path.join(folder, 'statuses.json')) ?? { entries: [] };
  const hasAdapter = existsSync(path.join(folder, 'adapter.ts'));
  const tracking = carrier.tracking ?? {};
  const route = tracking.mode === 'link-only' ? 'link only'
    : hasAdapter ? 'dedicated'
      : tracking.adapter === 'universal' ? 'universal providers'
        : `via ${tracking.adapter}`;
  const steps = Array.isArray(tracking.steps) && tracking.steps.length ? tracking.steps.join(' → ') : '';
  const capabilities = Array.isArray(carrier.capabilities) ? carrier.capabilities.length : 0;
  const docs = existsSync(path.join(folder, 'README.md')) ? `[README](carriers/${id}/README.md)` : '';
  return `| \`${id}\` | ${carrier.displayName ?? id} | ${route} | ${steps} | ${capabilities} | ${numbers.records?.length ?? 0} | ${statuses.entries?.length ?? 0} | ${docs} |`;
});

const providerRows = folders(providersRoot)
  .filter((id) => existsSync(path.join(providersRoot, id, 'adapter.ts')))
  .map((id) => `| \`${id}\` | ${existsSync(path.join(providersRoot, id, 'README.md')) ? `[README](providers/${id}/README.md)` : ''} |`);

const dedicated = rows.filter((row) => row.includes('| dedicated |')).length;
const universal = rows.filter((row) => row.includes('| universal providers |')).length;
const generated = [
  START,
  `${rows.length} carriers: ${dedicated} with a dedicated adapter, ${universal} tracked through the universal providers, the rest through another carrier's adapter or link only. Regenerate with \`node packages/carriers/scripts/generate-readme.mjs\`.`,
  '',
  'Roughly ordered by familiarity and prominence, with major carriers first (an editorial order, not a market-share ranking).',
  '',
  '| Id | Name | Route | Steps | Capabilities | Sample numbers | Known statuses | Docs |',
  '| --- | --- | --- | --- | ---: | ---: | ---: | --- |',
  ...rows,
  '',
  providerRows.length ? '### Universal providers' : '',
  providerRows.length ? '| Id | Docs |' : '',
  providerRows.length ? '| --- | --- |' : '',
  ...providerRows,
  END,
].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');

const current = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
const start = current.indexOf(START);
const end = current.indexOf(END);
const next = start >= 0 && end > start
  ? `${current.slice(0, start)}${generated}${current.slice(end + END.length)}`
  : `${current.trimEnd()}\n\n## Carriers\n\n${generated}\n`;

if (process.argv.includes('--check')) {
  if (current !== next) throw new Error('packages/carriers/README.md overview is stale. Run node packages/carriers/scripts/generate-readme.mjs.');
  console.log('Carrier overview is current.');
} else {
  writeFileSync(readmePath, next);
  console.log(`Wrote the overview for ${rows.length} carriers and ${providerRows.length} providers.`);
}
