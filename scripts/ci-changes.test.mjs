import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { planChanges, selectSuites, successfulBaseline } from './ci-changes.mjs';

const none = { web: false, migrations: false, ios: false };
const web = { ...none, web: true };
const ios = { ...none, ios: true };
const both = { ...web, ios: true };
const all = { web: true, migrations: true, ios: true };
const sha = digit => digit.repeat(40);
const successful = (head, overrides = {}) => ({
  id: 1, head_sha: head, head_branch: 'main', event: 'push', conclusion: 'success', ...overrides,
});

describe('test suite boundaries', () => {
  it('skips application suites for documentation, including native documentation', () => {
    assert.deepEqual(selectSuites([
      'README.md', 'docs/DEPLOYMENT.md', 'docs/assets/hero-light.webp', 'ios/README.md',
      'AGENTS.md', '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/pull_request_template.md',
    ]), none);
  });

  it('runs the SQL suite for migrations and its test harness', () => {
    for (const file of ['supabase/migrations/example.sql', 'supabase/tests/assertions.sql', 'scripts/test-migrations.sh']) {
      assert.deepEqual(selectSuites([file]), { ...none, migrations: true });
    }
  });

  it('runs native tests for native code, build configuration and generated resources', () => {
    for (const file of ['ios/PeekDeliveryTracker/Parcel.swift', 'ios/Configuration/Shared.xcconfig',
      'ios/PeekDeliveryTracker/Resources/CarrierCatalog.json']) {
      assert.deepEqual(selectSuites([file]), ios);
    }
  });

  it('runs all web suites for client, server, browser and build inputs', () => {
    for (const file of ['src/components/ParcelMap.tsx', 'src/server/trackingSync.ts', 'app/layout.tsx',
      'app/api/packages/route.ts', 'public/privacy.html', 'e2e/parcel-journeys.spec.ts', 'Dockerfile',
      'next.config.ts', 'instrumentation-client.ts', 'playwright.config.ts', 'scripts/test-pwa-build.mjs', 'PRIVACY.md',
      'content/guides/index.json']) {
      assert.deepEqual(selectSuites([file]), web, file);
    }
  });

  it('keeps browser and native coverage for dependencies and shared generator inputs', () => {
    for (const file of ['package.json', 'package-lock.json', 'shared/locales/en.json',
      'contracts/openapi.json', 'src/brand/identities.json', 'src/components/map/world.json',
      'src/components/map/detail.json', 'public/atlas/37_27.bin', 'scripts/generate-api-contract.mjs',
      'scripts/generate-ios-resources.mjs', 'scripts/generate-icons.mjs', 'scripts/prepare-personal-ios-project.mjs']) {
      assert.deepEqual(selectSuites([file]), both, file);
    }
  });

  it('combines every area in the range and runs everything for unknown paths or CI policy changes', () => {
    assert.deepEqual(selectSuites(['docs/SCRAPER.md', 'ios/Parcel.swift', 'supabase/tests/assertions.sql']),
      { ...ios, migrations: true });
    for (const file of ['new-runtime/worker.js', '.github/workflows/ci.yml', '.github/workflows/ios.yml',
      'scripts/ci-changes.mjs', 'scripts/ci-changes.test.mjs']) {
      assert.deepEqual(selectSuites([file]), all);
    }
  });
});

describe('successful workflow baselines', () => {
  it('chooses the nearest main ancestor instead of a recently rerun older commit', () => {
    const runs = [successful(sha('1')), successful(sha('2'))];
    assert.equal(successfulBaseline(runs, [sha('3'), sha('2'), sha('1')], 9), sha('2'));
  });

  it('ignores the current target, current run, failures, other branches, PRs and unrelated history', () => {
    const runs = [
      successful(sha('4')), successful(sha('3'), { id: 9 }),
      successful(sha('3'), { conclusion: 'cancelled' }), successful(sha('3'), { conclusion: 'failure' }),
      successful(sha('3'), { head_branch: 'topic' }), successful(sha('3'), { event: 'pull_request' }),
      successful(sha('3'), { head_sha: '--invalid' }), successful(sha('8')), successful(sha('2')),
    ];
    assert.equal(successfulBaseline(runs, [sha('4'), sha('3'), sha('2')], 9), sha('2'));
    assert.equal(successfulBaseline([], [sha('4'), sha('3')], 9), null);
  });
});

function withRepository(run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'delivery-ci-changes-'));
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = (file, contents = 'synthetic\n') => {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), contents);
    git(['add', '--', file]);
    git(['commit', '-qm', 'Synthetic fixture']);
    return git(['rev-parse', 'HEAD']).trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'CI fixture']);
  git(['config', 'user.email', 'ci@example.invalid']);
  try { run({ git, commit }); } finally { rmSync(directory, { recursive: true, force: true }); }
}

function pushPlan({ git, target, baseline, runs, workflow = 'ci.yml', before }) {
  return planChanges({
    eventName: 'push', event: { ref: 'refs/heads/main', before }, sha: target,
    runId: 9, repository: 'example/app', workflow,
    command(program, args) {
      if (program === 'git') return git(args);
      assert.equal(program, 'gh');
      assert.ok(args[1].includes(`/workflows/${workflow}/runs?`));
      return JSON.stringify({ workflow_runs: runs ?? [successful(baseline)] });
    },
  });
}

describe('Git range selection', () => {
  it('includes an untested earlier web commit when a later docs push replaces its queued run', () => {
    withRepository(({ git, commit }) => {
      const baseline = commit('README.md');
      const untested = commit('src/client.ts');
      const target = commit('docs/DEPLOYMENT.md');
      const plan = pushPlan({ git, target, baseline, before: untested });
      assert.equal(plan.base, baseline);
      assert.deepEqual(plan.suites, web);
      assert.ok(plan.files.includes('src/client.ts'));
    });
  });

  it('uses the native workflow history to cover canceled native runs across multiple commits', () => {
    withRepository(({ git, commit }) => {
      const baseline = commit('README.md');
      const canceled = commit('ios/Parcel.swift');
      const target = commit('docs/DEPLOYMENT.md');
      const plan = pushPlan({ git, target, workflow: 'ios.yml', runs: [
        successful(canceled, { conclusion: 'cancelled' }), successful(baseline),
      ] });
      assert.equal(plan.base, baseline);
      assert.deepEqual(plan.suites, ios);
    });
  });

  it('ignores a successful commit that is not on the target history after a force push', () => {
    withRepository(({ git, commit }) => {
      const baseline = commit('README.md');
      const removed = commit('ios/Parcel.swift');
      git(['reset', '--hard', baseline]);
      const target = commit('docs/DEPLOYMENT.md');
      const plan = pushPlan({ git, target, runs: [successful(removed)] });
      assert.equal(plan.base, null);
      assert.deepEqual(plan.suites, all);
    });
  });

  it('includes both the deleted and added areas when a file is renamed', () => {
    withRepository(({ git, commit }) => {
      commit('README.md');
      const baseline = commit('ios/Parcel.swift');
      git(['mv', 'ios/Parcel.swift', 'Parcel.ts']);
      git(['commit', '-qm', 'Move synthetic fixture']);
      const target = git(['rev-parse', 'HEAD']).trim();
      const plan = pushPlan({ git, target, baseline });
      assert.ok(plan.files.includes('ios/Parcel.swift'));
      assert.ok(plan.files.includes('Parcel.ts'));
      assert.deepEqual(plan.suites, all);
    });
  });

  it('compares the PR merge target with its base and does not use push history', () => {
    withRepository(({ git, commit }) => {
      const base = commit('README.md');
      git(['checkout', '-qb', 'topic']);
      commit('ios/Parcel.swift');
      git(['checkout', '-q', 'main']);
      const baseSha = commit('src/existing-main.ts');
      git(['merge', '--no-ff', '-qm', 'Synthetic PR merge', 'topic']);
      const target = git(['rev-parse', 'HEAD']).trim();
      const plan = planChanges({
        eventName: 'pull_request', event: { pull_request: { base: { sha: baseSha } } },
        sha: target, workflow: 'ios.yml', command(program, args) {
          assert.equal(program, 'git');
          return git(args);
        },
      });
      assert.notEqual(plan.base, base);
      assert.equal(plan.base, baseSha);
      assert.deepEqual(plan.files, ['ios/Parcel.swift']);
      assert.deepEqual(plan.suites, ios);
    });
  });

  it('runs all suites when workflow history, checkout history or the diff is unavailable', () => {
    withRepository(({ git, commit }) => {
      const baseline = commit('README.md');
      const target = commit('docs/DEPLOYMENT.md');
      const options = {
        eventName: 'push', event: { ref: 'refs/heads/main' }, sha: target,
        repository: 'example/app', workflow: 'ci.yml',
      };
      for (const failed of ['gh', 'rev-list', 'diff']) {
        const plan = planChanges({ ...options, command(program, args) {
          if (program === failed || args[0] === failed) throw new Error('Unavailable');
          return program === 'git' ? git(args) : JSON.stringify({ workflow_runs: [successful(baseline)] });
        } });
        assert.equal(plan.base, null);
        assert.deepEqual(plan.suites, all);
      }
      assert.deepEqual(planChanges({ ...options, sha: sha('8'), command: (_, args) => git(args) }).suites, all);
    });
  });
});

describe('deployment gating', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const expression = workflow.match(/  deploy:[\s\S]*?if: >-\s*\$\{\{([\s\S]*?)\}\}/)?.[1];
  const allowed = (overrides = {}, canceled = false) => runInNewContext(expression, {
    always: () => true, cancelled: () => canceled,
    github: { event_name: 'push', ref: 'refs/heads/main' }, vars: { DEPLOY_ENABLED: 'true' },
    needs: {
      changes: { result: 'success', outputs: { web: 'true', migrations: 'false' } },
      checks: { result: 'success' }, unit: { result: 'success' }, browser: { result: 'success' },
      image: { result: 'success' }, migrations: { result: 'skipped' }, ...overrides,
    },
  });

  it('allows intentionally skipped migrations and successful selected migrations', () => {
    assert.ok(expression, 'The deployment must have an explicit gate.');
    assert.equal(allowed(), true);
    assert.equal(allowed({ migrations: { result: 'success' },
      changes: { result: 'success', outputs: { web: 'true', migrations: 'true' } } }), true);
  });

  it('blocks failed or canceled checks and selected suites that were skipped', () => {
    for (const suite of ['changes', 'checks', 'unit', 'browser', 'image', 'migrations']) {
      for (const result of ['failure', 'cancelled']) assert.equal(allowed({ [suite]: { result } }), false);
    }
    assert.equal(allowed({ changes: { result: 'success', outputs: { web: 'true', migrations: 'true' } } }), false);
    assert.equal(allowed({ browser: { result: 'skipped' } }), false);
    assert.equal(allowed({}, true), false);
    assert.equal(allowed({ changes: { result: 'success', outputs: { web: 'false', migrations: 'false' } } }), false);
  });
});

describe('scraper adoption validation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/adopt-scraper.yml', import.meta.url), 'utf8');

  it('keeps database and peer gates and tests the app with the release, leaving the build to CI', () => {
    assert.ok(workflow.includes('node scripts/adopt-scraper.mjs gate'));
    assert.ok(workflow.includes('node scripts/adopt-scraper.mjs peers'));
    assert.ok(workflow.includes('npm run contract:generate'));
    assert.ok(workflow.includes('npm run ios:resources'));
    // A release that breaks the app's types or unit tests never reaches main,
    // and the job holding the push token still runs nothing of the release.
    const [adopt, push] = workflow.split(/\n  push:\n/);
    assert.ok(push, 'The push job must exist.');
    const tests = adopt.indexOf('npm test');
    assert.ok(adopt.includes('npm run typecheck') && tests > 0);
    assert.ok(adopt.indexOf('Write the adoption as a patch') < tests && tests < adopt.indexOf('Hand the patch to the push job'));
    assert.doesNotMatch(workflow, /npm (?:audit|run (?:lint|test:[\w:-]+|build))\b/);
    assert.doesNotMatch(push, /\bnpm\b/);
    assert.ok(workflow.includes('PUSH_TOKEN: ${{ secrets.SCRAPER_ADOPTION_TOKEN }}'));
  });

  it('refuses to push without the token that starts validation workflows', () => {
    const step = workflow.match(/      - name: Push to main[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name:)/)?.[1];
    assert.ok(step, 'The adoption push step must exist.');
    const script = step.split('\n').map(line => line.replace(/^          /, '')).join('\n');
    const directory = mkdtempSync(path.join(tmpdir(), 'delivery-adoption-token-'));
    try {
      assert.throws(() => execFileSync('bash', ['-e', '-c', script], {
        env: { ...process.env, PUSH_TOKEN: '', RUNNER_TEMP: directory }, encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }), error => error.status === 1 && error.stdout.includes('Nothing was pushed.'));
      assert.match(readFileSync(path.join(directory, 'stopped'), 'utf8'), /SCRAPER_ADOPTION_TOKEN is required/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
