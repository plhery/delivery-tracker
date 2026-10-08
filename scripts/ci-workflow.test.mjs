import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

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

// The app names its Sentry release after the image's commit; telling Sentry about a deploy is
// optional, and must never fail or precede it.
it('records the deployed commit in Sentry after the deploy, without ever failing it', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /IMAGE_COMMIT=\$\{\{ github\.sha \}\}/);
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
  const start = deploy.indexOf('- name: Record the release in Sentry');
  assert.ok(start > deploy.indexOf('- name: Check the public site'), 'the release is recorded once the site answers');
  const step = deploy.slice(start).split(/\n {6}- /)[0];
  assert.match(step, /\n {8}continue-on-error: true\n/);
  assert.match(step, /SENTRY_AUTH_TOKEN: \$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}/);
  assert.match(step, /if \[ -z "\$SENTRY_AUTH_TOKEN" \] \|\| \[ -z "\$SENTRY_PROJECT" \]; then[^]*?exit 0/);
  for (const command of ['releases new "$GITHUB_SHA"', 'releases set-commits "$GITHUB_SHA" --auto',
    'deploys new --release "$GITHUB_SHA" --env production']) {
    assert.ok(step.includes(command), command);
  }
});
