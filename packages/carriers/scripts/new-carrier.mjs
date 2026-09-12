/*
 * Scaffolds one carrier folder: the data files the catalog generator and the
 * detection sweep expect, plus one README for integration details.
 * carrier.json is validated against
 * core/catalog/carrier.schema.json before anything is written, so a fresh
 * folder is never the reason `npm run contract:generate` fails.
 *
 *   node packages/carriers/scripts/new-carrier.mjs --id <id> --name "<Name>" \
 *     [--mode automatic|link-only] [--adapter universal|<id>] \
 *     [--timezone <tz>] [--color #hex] [--portal-url <url>] [--canary-url <url>]
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(packageRoot, 'core', 'catalog', 'carrier.schema.json');

// Wording the corpus uses for a carrier with no sample number yet.
const emptyCorpusGap = 'no public sample found yet';

const usage = [
  'Usage: node packages/carriers/scripts/new-carrier.mjs --id <id> --name "<Name>"',
  '         [--mode automatic|link-only] [--adapter universal|<id>]',
  '         [--timezone <tz>] [--color #hex] [--portal-url <url>] [--canary-url <url>]',
].join('\n');

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument ${argument}\n${usage}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${argument} needs a value\n${usage}`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

function readOptions(argv) {
  const options = parseOptions(argv);
  const known = new Set(['id', 'name', 'mode', 'adapter', 'timezone', 'color', 'portal-url', 'canary-url']);
  const unknown = Object.keys(options).filter((key) => !known.has(key));
  if (unknown.length > 0) throw new Error(`Unknown option --${unknown[0]}\n${usage}`);
  if (!options.id || !options.name) throw new Error(`--id and --name are required\n${usage}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.id)) {
    throw new Error(`--id must be lowercase words joined by hyphens, got ${options.id}`);
  }
  const mode = options.mode ?? 'automatic';
  if (!['automatic', 'link-only'].includes(mode)) throw new Error('--mode must be automatic or link-only');
  if (mode === 'link-only' && options.adapter) {
    throw new Error('link-only carriers have no adapter; drop --adapter or use --mode automatic');
  }
  const color = options.color ?? '#8e8e93';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`--color must be a #rrggbb value, got ${color}`);
  return {
    id: options.id,
    name: options.name,
    mode,
    adapter: mode === 'link-only' ? null : options.adapter ?? 'universal',
    timezone: options.timezone ?? 'UTC',
    color,
    portalUrl: options['portal-url'],
    canaryUrl: options['canary-url'],
  };
}

/** Key order matches the schema and the existing 104 folders. */
function carrierDocument(options) {
  const portal = {};
  if (options.portalUrl) portal.url = options.portalUrl;
  if (options.canaryUrl) portal.canaryUrl = options.canaryUrl;
  return {
    id: options.id,
    displayName: options.name,
    aliases: [],
    region: { countries: [] },
    brand: { color: options.color },
    selectable: true,
    timezone: options.timezone,
    tracking: { mode: options.mode, adapter: options.adapter, steps: [] },
    capabilities: [],
    portal: { ...portal, shows: [], scraped: [], discarded: [], unavailable: [] },
    links: [],
    detection: [],
  };
}

function validateCarrier(carrier) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(schema);
  if (validate(carrier)) return;
  const details = validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
  throw new Error(`The generated carrier.json would be invalid: ${details}`);
}

function readmeSkeleton(options) {
  return `# ${options.name}

Catalog, portals and detection rules: [carrier.json](carrier.json).
Sample numbers: [numbers.json](numbers.json).
Status observations: [statuses.json](statuses.json).

## Integration

${options.mode === 'link-only' ? 'This carrier is link-only: we only recognize and rebuild its tracking link.' : 'TODO: describe the request flow, required inputs and recovery behavior.'}

## Limitations and decisions

TODO: record limitations and non-obvious choices that help maintain this
integration. Omit sections that add no useful context.

## Verification log

| Date | What was checked | Result |
| --- | --- | --- |
`;
}

function checklist(options) {
  const folder = `packages/carriers/carriers/${options.id}`;
  return [
    '',
    'Next steps:',
    options.mode === 'automatic' && !options.canaryUrl
      ? `  1. Add portal.canaryUrl to ${folder}/carrier.json (automatic carriers need a public, credential-free HTTPS URL).`
      : `  1. Review ${folder}/carrier.json: portal facts, links and detection rules.`,
    `  2. Add detection rules and tracking-link rules to ${folder}/carrier.json.`,
    `  3. Add evidence-tagged sample numbers to ${folder}/numbers.json, drop its "gap" line, and run the detection sweep.`,
    `  4. Record observed status wordings in ${folder}/statuses.json.`,
    `  5. Describe setup, limitations and verification in ${folder}/README.md.`,
    '  6. Run npm run contract:generate, then npm run ios:resources.',
    '  7. Run npm run test:contract and the carrier tests.',
    '',
  ].join('\n');
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const carrier = carrierDocument(options);
  validateCarrier(carrier);

  const folder = path.join(packageRoot, 'carriers', options.id);
  const exists = await access(folder).then(() => true, () => false);
  if (exists) throw new Error(`packages/carriers/carriers/${options.id} already exists`);

  await mkdir(folder, { recursive: true });
  const files = [
    ['carrier.json', `${JSON.stringify(carrier, null, 2)}\n`],
    // The detection sweep requires an empty corpus to state why it is empty,
    // so a fresh folder ships the gap and the first real record removes it.
    ['numbers.json', `${JSON.stringify({ carrier: options.id, gap: emptyCorpusGap, records: [] }, null, 2)}\n`],
    ['statuses.json', `${JSON.stringify({ carrier: options.id, entries: [] }, null, 2)}\n`],
    ['README.md', readmeSkeleton(options)],
  ];
  for (const [name, contents] of files) {
    await writeFile(path.join(folder, name), contents);
    console.log(`Wrote packages/carriers/carriers/${options.id}/${name}`);
  }
  console.log(checklist(options));
}

await main();
