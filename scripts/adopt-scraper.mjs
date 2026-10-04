// Adopts a Universal Parcel Scraper release, for .github/workflows/adopt-scraper.yml:
// which version to move to, and what that version changes among the things the
// database holds its own copy of. Every command also runs locally.
//
//   node scripts/adopt-scraper.mjs resolve [--version=1.2.3] [--database-ready]
//   node scripts/adopt-scraper.mjs snapshot <file>        before installing the release
//   node scripts/adopt-scraper.mjs gate <file> [--database-ready]
//   node scripts/adopt-scraper.mjs peers
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const PACKAGE_NAME = 'universal-parcel-scraper';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryUrl = `https://registry.npmjs.org/${PACKAGE_NAME}`;

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

// A stable release is X.Y.Z. A prerelease of the scraper's main branch is X.Y.Z-main.N.
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-main\.(0|[1-9]\d*))?$/;

export function parseVersion(value) {
  const match = typeof value === 'string' ? versionPattern.exec(value) : null;
  const numbers = match?.slice(1).map((part) => (part === undefined ? null : Number(part)));
  if (!numbers || numbers.some((number) => number !== null && !Number.isSafeInteger(number))) {
    throw new TypeError(`Not a scraper release version: ${JSON.stringify(value)?.slice(0, 80)}`);
  }
  const [major, minor, patch, prerelease] = numbers;
  return { major, minor, patch, prerelease };
}

/** Semver precedence: a prerelease comes before the release it leads to. */
export function compareVersions(first, second) {
  const a = parseVersion(first);
  const b = parseVersion(second);
  for (const part of ['major', 'minor', 'patch']) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/** The exact release package.json pins. */
export function pinnedVersion(manifest) {
  const pinned = manifest.dependencies?.[PACKAGE_NAME];
  try {
    parseVersion(pinned);
  } catch {
    throw new Error(`package.json must pin ${PACKAGE_NAME} to an exact release, not ${JSON.stringify(pinned)}`);
  }
  return pinned;
}

/**
 * The release to move to: the requested one, otherwise the newer of npm's
 * `latest` and `next`. `adopt` is false when the app is already on it or newer.
 * `databaseReady` vouches for the migration of one release, so it needs the request.
 */
export function chooseTarget({ current, requested = '', distTags = {}, databaseReady = false }) {
  parseVersion(current);
  if (databaseReady && !requested) {
    throw new Error('database_ready confirms the migration of one release: pass -f version=<version> with it.');
  }
  let version = requested;
  if (requested) {
    parseVersion(requested);
  } else {
    const published = ['latest', 'next'].filter((tag) => distTags[tag] !== undefined).map((tag) => {
      try {
        parseVersion(distTags[tag]);
      } catch {
        throw new Error(`npm tags ${JSON.stringify(distTags[tag])} as ${tag}, which is not a scraper release version`);
      }
      return distTags[tag];
    });
    if (published.length === 0) throw new Error(`npm has no latest or next ${PACKAGE_NAME} release`);
    version = published.reduce((newest, candidate) => (compareVersions(candidate, newest) > 0 ? candidate : newest));
  }
  return { version, adopt: compareVersions(version, current) > 0 };
}

// ---------------------------------------------------------------------------
// What the database enforces
// ---------------------------------------------------------------------------

/** The constraints and functions in supabase/migrations that copy each facet. */
export const ENFORCED_BY = {
  carriers: ['packages_carrier_check', 'create_owned_package', 'change_owned_package_carrier'],
  inputs: [
    'packages_dpd_postcode_check', 'packages_tracking_url_check',
    'create_owned_package', 'change_owned_package_carrier',
  ],
  numberShapes: ['packages_tracking_number_format_check', 'create_owned_package', 'create_one_off_parcel'],
  forcedCarriers: ['change_owned_package_carrier'],
  stages: [
    'tracking_events_stage_check', 'packages_current_stage_check', 'notification_preferences_stages_check',
    'set_owned_notification_preferences',
  ],
  providers: ['tracking_provider_health_provider_check'],
};

const facetTitles = {
  carriers: 'Carrier ids',
  inputs: 'Inputs a carrier asks for',
  numberShapes: 'Tracking numbers that are not plain letters and digits',
  forcedCarriers: 'Tracking numbers that always belong to one carrier',
  stages: 'Stages',
  providers: 'Universal providers',
};

const facetNotes = {
  forcedCarriers: 'The app copies this shape too, in `src/server/validation.ts`.',
  stages: 'A stage the app notifies about also joins the default of `notification_preferences.enabled_stages` '
    + 'and raises the limit on how many stages an account enables. '
    + 'A stage is also part of the API: edit the `Stage` enum in `contracts/openapi.json` by hand.',
};

// Carriers the database recognises by number: it moves a matching parcel to them.
const carriersForcedByNumber = ['quickpac'];

/**
 * Whether a detection pattern can only match the uppercase letters and digits
 * the database stores. A pattern this does not understand counts as wider.
 */
export function matchesOnlyLettersAndDigits(pattern) {
  const groups = []; // for each open group, whether it is a lookahead
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const consumes = !groups.includes(true); // a lookahead consumes nothing
    if (character === '\\') {
      index += 1;
      if (consumes && pattern[index] !== 'd') return false;
    } else if (inClass) {
      if (character === ']') inClass = false;
      else if (consumes && !/[A-Z0-9-]/.test(character)) return false;
    } else if (character === '[') {
      inClass = true;
      if (consumes && pattern[index + 1] === '^') return false;
    } else if (character === '(') {
      const opener = pattern.slice(index, index + 3);
      if (opener.startsWith('(?') && !['(?:', '(?=', '(?!'].includes(opener)) return false;
      groups.push(opener === '(?=' || opener === '(?!');
      if (opener.startsWith('(?')) index += 2;
    } else if (character === ')') {
      groups.pop();
    } else if (character === '{') {
      const end = pattern.indexOf('}', index);
      if (!/^\{\d+(?:,\d*)?\}$/.test(pattern.slice(index, end + 1))) return false;
      index = end;
    } else if (consumes && !/[A-Z0-9|?*+^$]/.test(character)) {
      return false;
    }
  }
  return true;
}

function inputFacet(carrier, requirement) {
  return [
    `${carrier}: ${requirement.field}`,
    `validator ${requirement.validator}`,
    requirement.optional ? 'optional' : 'required',
    ...(requirement.whenTrackingNumber ? [`for numbers matching ${requirement.whenTrackingNumber}`] : []),
    ...(requirement.pattern ? [`pattern ${requirement.pattern}`] : []),
  ].join(', ');
}

/**
 * The part of a release the database copies, as sorted lists of plain strings.
 * Names, colors, links, refresh timing and ordinary detection rules are left
 * out: the database does not know them.
 */
export function databaseFacets({ catalog, stages, providers }) {
  const carriers = Object.keys(catalog).sort();
  const inputs = [];
  const numberShapes = [];
  const forcedCarriers = [];
  for (const carrier of carriers) {
    for (const requirement of catalog[carrier].tracking?.requirements ?? []) {
      inputs.push(inputFacet(carrier, requirement));
    }
    for (const rule of catalog[carrier].detectionRules ?? []) {
      if (!matchesOnlyLettersAndDigits(rule.pattern)) numberShapes.push(`${carrier}: ${rule.pattern}`);
      if (carriersForcedByNumber.includes(carrier) && rule.confidence === 'high') {
        forcedCarriers.push(`${carrier}: ${rule.pattern}`);
      }
    }
  }
  return {
    carriers,
    inputs: inputs.sort(),
    numberShapes: numberShapes.sort(),
    forcedCarriers: forcedCarriers.sort(),
    stages: [...stages].sort(),
    providers: [...providers].sort(),
  };
}

/** The facets that differ, with what each gained and lost. */
export function diffDatabaseFacets(before, after) {
  return Object.keys(ENFORCED_BY).flatMap((facet) => {
    const was = new Set(before[facet]);
    const is = new Set(after[facet]);
    const added = [...is].filter((entry) => !was.has(entry));
    const removed = [...was].filter((entry) => !is.has(entry));
    return added.length > 0 || removed.length > 0 ? [{ facet, added, removed }] : [];
  });
}

export function continueCommand(version) {
  return `gh workflow run adopt-scraper.yml -f version=${version} -f database_ready=true`;
}

/** The gate's report in Markdown. It blocks unless `databaseReady` or nothing changed. */
export function gateReport({ from, to, changes, databaseReady }) {
  if (changes.length === 0) {
    return `Universal Parcel Scraper ${to} changes nothing the database enforces, compared with ${from}.`;
  }
  const code = (text) => `\`${text}\``;
  const lines = [
    databaseReady
      ? `### Universal Parcel Scraper ${to} changes what the database enforces, confirmed as applied`
      : `### Blocked: Universal Parcel Scraper ${to} changes what the database enforces`,
    '',
    `Compared with ${from}:`,
  ];
  for (const { facet, added, removed } of changes) {
    lines.push('', `**${facetTitles[facet]}** (${ENFORCED_BY[facet].map(code).join(', ')})`, '');
    lines.push(...added.map((entry) => `- added: ${code(entry)}`));
    lines.push(...removed.map((entry) => `- removed: ${code(entry)}`));
    if (facetNotes[facet]) lines.push('', facetNotes[facet]);
  }
  if (!databaseReady) {
    lines.push(
      '',
      'Nothing was pushed. Apply the migration these changes need to the production database, then continue:',
      '',
      '```bash',
      continueCommand(to),
      '```',
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Peer pins
// ---------------------------------------------------------------------------

/**
 * Packages the release expects at one exact version while the app has another.
 * npm stays silent about them: .npmrc sets legacy-peer-deps.
 */
export function peerMismatches(peerDependencies = {}, installedVersions = {}) {
  return Object.entries(peerDependencies)
    .filter(([name, expected]) => /^\d+\.\d+\.\d+$/.test(expected)
      && installedVersions[name] !== undefined && installedVersions[name] !== expected)
    .map(([name, expected]) => ({ name, expected, installed: installedVersions[name] }));
}

// ---------------------------------------------------------------------------
// npm registry
// ---------------------------------------------------------------------------

/** Runs `task` until it succeeds; the last failure is thrown after `attempts`. */
export async function retry(task, { attempts, pauseMs, pause = delay }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await pause(pauseMs);
    }
  }
}

async function registryDocument() {
  // The document `npm install` reads, so that both see the same releases.
  const response = await fetch(registryUrl, {
    headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`The npm registry answered ${response.status} for ${PACKAGE_NAME}`);
  const document = await response.json();
  return { distTags: document['dist-tags'] ?? {}, versions: Object.keys(document.versions ?? {}) };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function installedManifest(name) {
  return readJson(path.join(root, 'node_modules', name, 'package.json'));
}

/** The installed release and its database facets. */
export async function installedRelease() {
  const scraper = await import(PACKAGE_NAME);
  if (typeof scraper.universalSources !== 'function') {
    throw new Error(`The installed ${PACKAGE_NAME} does not export universalSources`);
  }
  return {
    version: (await installedManifest(PACKAGE_NAME)).version,
    facets: databaseFacets({
      catalog: scraper.CARRIER_CATALOG,
      stages: scraper.STAGES,
      // Every provider the router can ask, the opt-in one included.
      providers: scraper.universalSources(true),
    }),
  };
}

async function summarize(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

async function resolveTarget(requested, databaseReady) {
  const current = pinnedVersion(await readJson(path.join(root, 'package.json')));
  const distTags = requested ? {} : (await retry(registryDocument, { attempts: 3, pauseMs: 5_000 })).distTags;
  const target = chooseTarget({ current, requested, distTags, databaseReady });
  if (target.adopt) {
    // npm scans a release for minutes before serving it. The scraper dispatches
    // once npm lists it; a run started by hand can name one still in the scan.
    // This waits half an hour.
    await retry(async () => {
      if (!(await registryDocument()).versions.includes(target.version)) {
        console.error(`Waiting for npm to serve ${PACKAGE_NAME}@${target.version}.`);
        throw new Error(`npm does not serve ${PACKAGE_NAME}@${target.version}`);
      }
    }, { attempts: 121, pauseMs: 15_000 });
  }
  const outputs = `version=${target.version}\ncurrent=${current}\nadopt=${target.adopt}\n`;
  process.stdout.write(outputs);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, outputs);
  if (!target.adopt) {
    await summarize(`### Nothing to adopt\n\nThe app is on Universal Parcel Scraper ${current}${
      target.version === current ? '.' : `, which is newer than ${target.version}.`}`);
  }
}

async function gate(snapshotFile, databaseReady) {
  const before = await readJson(snapshotFile);
  const after = await installedRelease();
  const changes = diffDatabaseFacets(before.facets, after.facets);
  await summarize(gateReport({ from: before.version, to: after.version, changes, databaseReady }));
  if (changes.length > 0 && !databaseReady) process.exitCode = 1;
}

async function checkPeers() {
  const release = await installedManifest(PACKAGE_NAME);
  const installed = {};
  for (const name of Object.keys(release.peerDependencies ?? {})) {
    installed[name] = (await installedManifest(name).catch(() => ({}))).version;
  }
  const mismatches = peerMismatches(release.peerDependencies, installed);
  if (mismatches.length === 0) {
    console.log(`The app's pins match what ${PACKAGE_NAME} ${release.version} expects.`);
    return;
  }
  await summarize([
    `### Universal Parcel Scraper ${release.version} expects other versions than the app pins`,
    '',
    ...mismatches.map(({ name, expected, installed: has }) => `- \`${name}\` ${expected}, the app has ${has}`),
    '',
    'Move these pins and the scraper in one commit.',
  ].join('\n'));
  process.exitCode = 1;
}

async function main() {
  const { positionals: [command, file], values } = parseArgs({
    allowPositionals: true,
    options: {
      version: { type: 'string', default: '' },
      'database-ready': { type: 'boolean', default: false },
    },
  });
  if (command === 'resolve') return resolveTarget(values.version.trim(), values['database-ready']);
  if (command === 'snapshot' && file) return writeFile(file, `${JSON.stringify(await installedRelease(), null, 2)}\n`);
  if (command === 'gate' && file) return gate(file, values['database-ready']);
  if (command === 'peers') return checkPeers();
  throw new Error('Usage: adopt-scraper.mjs resolve [--version=X.Y.Z] [--database-ready] | snapshot <file> | gate <file> [--database-ready] | peers');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const message = String(error?.message ?? error).replace(/\s+/g, ' ');
    console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Scraper adoption stopped\n\n${message}\n`);
    }
    process.exitCode = 1;
  }
}
