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
