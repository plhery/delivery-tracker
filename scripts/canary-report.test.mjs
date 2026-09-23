import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import CanaryReporter, { writeCanaryReport } from './canary-report.mjs';

function githubFiles() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-report-'));
  return { GITHUB_STEP_SUMMARY: path.join(directory, 'summary.md'), GITHUB_OUTPUT: path.join(directory, 'output') };
}

test('lists failed and inconclusive checks but counts gated ones', (t) => {
  const env = githubFiles();
  for (const [name, value] of Object.entries({ ...env, CANARY_SUMMARY_TITLE: 'Adapters' })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const testCase = (fullName, result) => ({ fullName, result: () => result });
  new CanaryReporter().onTestRunEnd([{
    relativeModuleId: 'carriers/ctt/adapter.live.test.ts',
    errors: () => [],
    children: {
      *allTests() {
        yield testCase('CTT > maps a wrong number to a 404', { state: 'passed' });
        yield testCase('PostNL > maps a wrong number to a 404', {
          state: 'failed', errors: [{ name: 'AssertionError', message: 'expected 429\n  to be | 404' }],
        });
        yield testCase('UPS > opens a tracking page', { state: 'skipped', note: 'Carrier bot protection' });
        yield testCase('FedEx > returns real history', { state: 'skipped', note: undefined });
      },
    },
  }], []);

  const summary = fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8');
  assert.match(summary, /^### Adapters\n\n1 passed · 1 failed · 1 unverified · 1 not run/);
  assert.match(summary, /\| ❌ failed \| PostNL > maps a wrong number to a 404 \| AssertionError: expected 429 to be \\\| 404 \|/);
  assert.match(summary, /\| ⚠️ unverified \| UPS > opens a tracking page \| Carrier bot protection \|/);
  assert.doesNotMatch(summary, /FedEx|CTT/);
  assert.match(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'),
    /^failures<<(EOF_[\w-]+)\n- `PostNL > maps a wrong number to a 404`: AssertionError: expected 429 to be \\\| 404\n\1\n$/);
});

test('writes nothing outside GitHub Actions and no output without failures', () => {
  assert.doesNotThrow(() => writeCanaryReport({ title: 'Probe', totals: '1/1', rows: [] }, {}));
  const env = githubFiles();
  writeCanaryReport({ title: 'Probe', totals: '1/1 reachable', rows: [] }, env);
  assert.equal(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), '### Probe\n\n1/1 reachable\n\n');
  assert.equal(fs.existsSync(env.GITHUB_OUTPUT), false);
});
