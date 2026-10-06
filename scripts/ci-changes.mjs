import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const allSuites = { web: true, migrations: true, ios: true };
const documentation = new Set([
  'README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'AGENTS.md',
  'LICENSE', 'ios/README.md', 'ops/sentry/README.md',
]);
const nativeInputs = new Set([
  'scripts/generate-api-contract.mjs', 'scripts/generate-brand.mjs', 'scripts/generate-icons.mjs',
  'scripts/generate-ios-resources.mjs', 'scripts/localization-catalog.mjs',
  'scripts/native-localization.mjs', 'scripts/native-localization.test.mjs',
  'scripts/prepare-personal-ios-project.mjs', 'scripts/prepare-personal-ios-project.test.mjs',
  'scripts/validate-ios-install.mjs', 'scripts/validate-ios-install.test.mjs', 'scripts/refresh-ios-app.sh',
  'src/components/map/world.json', 'src/components/map/detail.json',
]);
const webConfiguration = new Set([
  'Dockerfile', '.dockerignore', '.env.example', 'next.config.ts', 'next-env.d.ts',
  'tsconfig.json', 'eslint.config.js', 'vitest.config.ts', 'vitest.server.config.ts',
  'playwright.config.ts', 'instrumentation.ts', 'instrumentation-node.ts', 'proxy.ts',
  'PRIVACY.md',
]);

/** Unknown paths run everything. Only known, independent areas can skip suites. */
export function selectSuites(files) {
  const suites = { web: false, migrations: false, ios: false };
  for (const file of files) {
    if (file === 'scripts/ci-changes.mjs' || file === 'scripts/ci-changes.test.mjs') return { ...allSuites };
    if (documentation.has(file) || file.startsWith('docs/')
      || file.startsWith('.github/ISSUE_TEMPLATE/') || file === '.github/pull_request_template.md') continue;
    if (file.startsWith('supabase/') || file === 'scripts/test-migrations.sh') {
      suites.migrations = true;
    } else if (file.startsWith('ios/')) {
      suites.ios = true;
    } else if (file === 'package.json' || file === 'package-lock.json'
      || file.startsWith('shared/') || file.startsWith('contracts/')
      || file.startsWith('src/brand/') || file.startsWith('public/atlas/') || nativeInputs.has(file)) {
      suites.web = true;
      suites.ios = true;
    } else if (file.startsWith('app/') || file.startsWith('src/')
      || file.startsWith('public/') || file.startsWith('e2e/')
      || file.startsWith('scripts/') || webConfiguration.has(file)) {
      suites.web = true;
    } else {
      return { ...allSuites };
    }
  }
  return suites;
}

/** Pick the nearest successful main ancestor, even when an older run was rerun later. */
export function successfulBaseline(runs, ancestors, runId) {
  const successful = new Set(runs
    .filter(run => run.conclusion === 'success' && run.event === 'push' && run.head_branch === 'main'
      && String(run.id) !== String(runId) && /^[a-f0-9]{40}$/.test(run.head_sha))
    .map(run => run.head_sha));
  // Exclude HEAD itself so rerunning a successful commit still exercises its changes.
  return ancestors.slice(1).find(sha => successful.has(sha)) ?? null;
}

function execute(program, args) {
  return execFileSync(program, args, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Compare the tested target with a trusted baseline, never just the latest push's parent. */
export function planChanges({ eventName, event, sha, runId, repository, workflow, command = execute }) {
  const full = reason => ({ base: null, reason, files: [], suites: { ...allSuites } });
  try {
    if (!['ci.yml', 'ios.yml'].includes(workflow) || !/^[a-f0-9]{40}$/.test(sha)
      || command('git', ['rev-parse', 'HEAD']).trim() !== sha) {
      return full('The checked-out target or workflow could not be verified.');
    }
    let base;
    if (eventName === 'pull_request') {
      const baseSha = event.pull_request?.base?.sha;
      if (!/^[a-f0-9]{40}$/.test(baseSha)) return full('The pull request base is unavailable.');
      base = command('git', ['merge-base', baseSha, sha]).trim();
    } else if (eventName === 'push' && event.ref === 'refs/heads/main') {
      const response = JSON.parse(command('gh', ['api',
        `repos/${repository}/actions/workflows/${workflow}/runs?branch=main&event=push&status=success&per_page=100`,
      ]));
      const ancestors = command('git', ['rev-list', '--first-parent', sha]).trim().split('\n');
      base = successfulBaseline(response.workflow_runs, ancestors, runId);
      if (!base) return full('No successful main ancestor is available for this workflow.');
    } else {
      return full('This event has no trusted comparison baseline.');
    }
    if (!/^[a-f0-9]{40}$/.test(base)) return full('The comparison baseline is invalid.');
    // With rename detection off, moving a file checks both its old and new areas.
    const files = command('git', ['diff', '--name-only', '--no-renames', '-z', base, sha])
      .split('\0').filter(Boolean);
    return { base, reason: 'Changes since the comparison baseline.', files, suites: selectSuites(files) };
  } catch {
    // API, history and diff failures must never silently turn off validation.
    return full('The workflow history or Git comparison is unavailable.');
  }
}

function main() {
  const plan = planChanges({
    eventName: process.env.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    sha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    repository: process.env.GITHUB_REPOSITORY,
    workflow: process.argv[2],
  });
  const outputs = Object.entries(plan.suites).map(([suite, enabled]) => `${suite}=${enabled}\n`).join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  console.log(`${plan.reason} Baseline: ${plan.base ?? 'full validation'}.\n${outputs.trim()}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `Comparison baseline: ${plan.base ? `\`${plan.base}\`` : 'unavailable; run all suites'}.\n\n`
      + Object.entries(plan.suites).map(([suite, enabled]) => `- ${suite}: ${enabled ? 'run' : 'skip'}\n`).join(''));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
