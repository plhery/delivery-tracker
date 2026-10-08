import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { DEPLOY_JOB, DEPLOY_STEP, HANDOFF_JOB, MAX_WAIT_MS } from './deploy-gate.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// The browser journeys run in Playwright's image, which holds only its own version's browsers.
it('runs the browser journeys in the image of the installed Playwright', () => {
  const lock = JSON.parse(read('package-lock.json')).packages;
  const image = read('.github/workflows/ci.yml').match(/mcr\.microsoft\.com\/playwright:v([0-9.]+)-noble@sha256:[0-9a-f]{64}/);
  assert.ok(image, 'ci.yml must name the Playwright image by version and digest');
  for (const name of ['playwright-core', '@playwright/test']) {
    assert.equal(lock[`node_modules/${name}`].version, image[1],
      `${name} moved without the browser image in ci.yml: use mcr.microsoft.com/playwright:v${lock[`node_modules/${name}`].version}-noble with its digest`);
  }
});

const job = (workflow, id) => {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.ok(start >= 0, `no ${id} job`);
  const end = workflow.slice(start + 1).search(/\n {2}(?:# .*\n {2})*[a-z][a-z-]*:\n/);
  return end < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + end);
};
const step = (body, name) => {
  const start = body.indexOf(`- name: ${name}`);
  assert.ok(start >= 0, `no step ${name}`);
  return body.slice(start).split(/\n {6}- /)[0];
};

// CI hands a tested commit over; deploy.yml waits for newer ones and deploys (scripts/deploy-gate.mjs).
it('hands a tested commit on main to the Deploy workflow, which alone deploys', () => {
  const ci = read('.github/workflows/ci.yml');
  const handoff = job(ci, 'deploy');
  assert.match(handoff, new RegExp(`\n {4}name: ${HANDOFF_JOB}\n`));
  for (const need of ['changes.result', 'checks.result', 'unit.result', 'browser.result', 'image.result', 'migrations.result']) {
    assert.ok(handoff.includes(`needs.${need}`), need);
  }
  assert.match(handoff, /github\.ref == 'refs\/heads\/main'/);
  assert.match(handoff, /\n {4}permissions:\n {6}contents: read\n {6}actions: write\n {4}steps:/);
  assert.match(handoff, /gh workflow run deploy\.yml --repo "\$GITHUB_REPOSITORY" --ref main -f commit="\$GITHUB_SHA"/);
  // A re-run of an older commit would replace a newer one waiting to deploy.
  assert.match(handoff, /if \[ "\$GITHUB_RUN_ATTEMPT" != 1 \] && \[ "\$current_sha" != "\$GITHUB_SHA" \]; then[^]*?exit 0\n[^]*?gh workflow run/);
  assert.doesNotMatch(ci, /secrets\.DEPLOY_SSH|group: production-deploy/);
});

it('waits in a job a newer commit replaces, and deploys in one that is never cut off', () => {
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(workflow, /\non:\n {2}workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /\n {2}(push|pull_request|workflow_run):/);
  const settle = job(workflow, 'settle');
  assert.match(settle, /concurrency:\n {6}group: production-deploy-wait\n {6}cancel-in-progress: true\n/);
  assert.match(settle, /run: node scripts\/deploy-gate\.mjs "--commit=\$COMMIT"/);
  const minutes = Number(settle.match(/timeout-minutes: (\d+)/)[1]);
  assert.ok(minutes * 60_000 > MAX_WAIT_MS + 5 * 60_000, 'the wait ends before the job times out');
  const deploy = job(workflow, 'deploy');
  assert.match(deploy, new RegExp(`\n {4}name: ${DEPLOY_JOB}\n {4}needs: settle\n {4}if: needs\\.settle\\.outputs\\.deploy == 'true'\n`));
  assert.match(deploy, /concurrency:\n {6}group: production-deploy\n {6}cancel-in-progress: false\n/);
  assert.match(deploy, /COMMIT: \$\{\{ needs\.settle\.outputs\.commit \}\}/);
  assert.match(deploy, /ref: \$\{\{ needs\.settle\.outputs\.commit \}\}/);
  assert.match(step(deploy, DEPLOY_STEP), /"\$DEPLOY_SSH_TARGET" deploy "\$COMMIT"/);
  assert.ok(deploy.indexOf("- name: Check that production has this commit's migrations") < deploy.indexOf(`- name: ${DEPLOY_STEP}`));
  assert.doesNotMatch(deploy, /GITHUB_SHA/);
  // Re-running the job alone must not put back a commit that a newer one replaced.
  const guard = step(deploy, 'Skip a re-run of a commit that a newer one replaced');
  assert.match(guard, /if: github\.run_attempt != '1'/);
  assert.match(guard, /run: node scripts\/deploy-gate\.mjs "--commit=\$COMMIT" --at-once/);
  for (const name of ["Check that production has this commit's migrations", DEPLOY_STEP, 'Check the public site', 'Record the release in Sentry']) {
    assert.match(step(deploy, name), /\n {8}if: steps\.current\.outputs\.deploy != 'false'\n/, name);
  }
});

// The app names its Sentry release after the image's commit; telling Sentry about a deploy is
// optional, and must never fail or precede it.
it('records the deployed commit in Sentry after the deploy, without ever failing it', () => {
  assert.match(read('.github/workflows/ci.yml'), /IMAGE_COMMIT=\$\{\{ github\.sha \}\}/);
  const deploy = job(read('.github/workflows/deploy.yml'), 'deploy');
  const start = deploy.indexOf('- name: Record the release in Sentry');
  assert.ok(start > deploy.indexOf('- name: Check the public site'), 'the release is recorded once the site answers');
  const release = step(deploy, 'Record the release in Sentry');
  assert.match(release, /\n {8}continue-on-error: true\n/);
  assert.match(release, /SENTRY_AUTH_TOKEN: \$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}/);
  assert.match(release, /if \[ -z "\$SENTRY_AUTH_TOKEN" \] \|\| \[ -z "\$SENTRY_PROJECT" \]; then[^]*?exit 0/);
  for (const command of ['releases new "$COMMIT"', 'releases set-commits "$COMMIT" --auto',
    'deploys new --release "$COMMIT" --env production']) {
    assert.ok(release.includes(command), command);
  }
});
