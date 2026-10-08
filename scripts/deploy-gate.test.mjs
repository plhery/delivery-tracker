import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import {
  DEPLOY_JOB, DEPLOY_STEP, HANDOFF_JOB, MAX_WAIT_MS, decide, deployedBy, handoffState, newestTested, waitingSince,
} from './deploy-gate.mjs';

const sha = digit => digit.repeat(40);
const at = minute => new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString();
const run = (digit, minute, status = 'completed', handoff = 'done') => ({ id: Number(digit), head_sha: sha(digit), created_at: at(minute), status, handoff });
const handoff = async ({ handoff: state }) => state;
const minutes = count => Date.parse(at(0)) + count * 60_000;

describe('a CI run', () => {
  it('handed its commit over once its hand-over job succeeded, or while it runs', () => {
    assert.equal(handoffState([{ name: HANDOFF_JOB, status: 'completed', conclusion: 'success' }]), 'done');
    assert.equal(handoffState([{ name: HANDOFF_JOB, status: 'in_progress', conclusion: null }]), 'running');
    assert.equal(handoffState([{ name: HANDOFF_JOB, status: 'completed', conclusion: 'skipped' }]), 'none');
    assert.equal(handoffState([{ name: 'Unit tests', status: 'completed', conclusion: 'success' }]), 'none');
  });

  it('deployed when the deploy step succeeded, even if a later check failed', () => {
    const job = (conclusion) => [{ name: DEPLOY_JOB, steps: [{ name: DEPLOY_STEP, conclusion }, { name: 'Check the public site', conclusion: 'failure' }] }];
    assert.equal(deployedBy(job('success')), true);
    assert.equal(deployedBy(job('skipped')), false);
    assert.equal(deployedBy([{ name: 'Wait for newer commits', steps: [] }]), false);
  });
});

describe('deciding a deploy', () => {
  const base = { handoff, now: minutes(10), since: minutes(8), wait: true };

  it('deploys when CI tests nothing newer', async () => {
    const runs = [run('2', 5, 'completed', 'none'), run('1', 0, 'in_progress', 'running')];
    assert.equal((await decide({ ...base, commit: sha('1'), runs })).action, 'deploy');
  });

  it('waits while CI tests a newer commit', async () => {
    const runs = [run('3', 7, 'pending', 'none'), run('2', 5, 'in_progress', 'running'), run('1', 0)];
    const decision = await decide({ ...base, commit: sha('1'), runs });
    assert.equal(decision.action, 'wait');
    assert.match(decision.reason, new RegExp(sha('3')));
  });

  it('leaves the deploy to a newer commit that passed', async () => {
    const runs = [run('3', 7, 'in_progress', 'none'), run('2', 5), run('1', 0)];
    assert.equal((await decide({ ...base, commit: sha('1'), runs })).action, 'stand-down');
  });

  it('deploys when the newer commits failed or change nothing the server runs', async () => {
    const runs = [run('3', 7, 'completed', 'none'), run('2', 5, 'completed', 'none'), run('1', 0)];
    assert.equal((await decide({ ...base, commit: sha('1'), runs })).action, 'deploy');
  });

  it('stops waiting once tested commits have waited the longest allowed', async () => {
    const runs = [run('2', 5, 'in_progress', 'none'), run('1', 0)];
    assert.equal((await decide({ ...base, commit: sha('1'), runs, now: minutes(8) + MAX_WAIT_MS - 1 })).action, 'wait');
    assert.equal((await decide({ ...base, commit: sha('1'), runs, now: minutes(8) + MAX_WAIT_MS })).action, 'deploy');
  });

  it('deploys at once when asked, but never over a newer tested commit', async () => {
    const testing = [run('2', 5, 'in_progress', 'none'), run('1', 0)];
    assert.equal((await decide({ ...base, commit: sha('1'), runs: testing, wait: false })).action, 'deploy');
    const passed = [run('2', 5), run('1', 0)];
    assert.equal((await decide({ ...base, commit: sha('1'), runs: passed, wait: false })).action, 'stand-down');
  });

  it('refuses a commit CI did not pass, and leaves one older than its recent runs', async () => {
    const runs = [run('2', 5), run('1', 0, 'completed', 'none')];
    assert.equal((await decide({ ...base, commit: sha('1'), runs })).action, 'refuse');
    assert.equal((await decide({ ...base, commit: sha('9'), runs })).action, 'stand-down');
  });

  it('picks the newest commit CI passed for a deploy by hand', async () => {
    const runs = [run('3', 7, 'in_progress', 'running'), run('2', 5, 'completed', 'none'), run('1', 0)];
    assert.equal(await newestTested(runs, handoff), sha('1'));
    assert.equal(await newestTested([run('2', 5, 'completed', 'none')], handoff), null);
  });
});

describe('how long tested commits have waited', () => {
  const deployed = async ({ deployed: value }) => value;
  const deploy = (id, minute, value, status = 'completed') => ({ id, created_at: at(minute), status, deployed: value });

  it('counts from the oldest hand-over since the last deploy', async () => {
    const runs = [deploy(5, 9, false, 'pending'), deploy(4, 7, false, 'in_progress'), deploy(3, 5, false), deploy(2, 3, false), deploy(1, 0, true)];
    assert.equal(await waitingSince(runs, 4, deployed), minutes(3));
  });

  it('counts from its own hand-over right after a deploy, and is unknown without it', async () => {
    const runs = [deploy(2, 4, false, 'in_progress'), deploy(1, 0, true)];
    assert.equal(await waitingSince(runs, 2, deployed), minutes(4));
    assert.equal(await waitingSince(runs, 7, deployed), null);
  });
});

describe('the command', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'deploy-gate-'));
  after(() => rmSync(directory, { recursive: true, force: true }));
  // Answers `gh api <endpoint>` from the fixture in GH_FIXTURE.
  writeFileSync(path.join(directory, 'gh'), `#!/usr/bin/env node
const fixture = JSON.parse(process.env.GH_FIXTURE);
const endpoint = process.argv[3];
const key = Object.keys(fixture).find(prefix => endpoint.startsWith(prefix));
if (!key) { console.error('unexpected ' + endpoint); process.exit(1); }
process.stdout.write(JSON.stringify(fixture[key]));
`, { mode: 0o755 });
  const ciRun = (digit, minute, status = 'completed') => ({ id: Number(digit), run_attempt: 1, event: 'push', head_branch: 'main', head_sha: sha(digit), created_at: at(minute), status });
  const passed = { jobs: [{ name: HANDOFF_JOB, status: 'completed', conclusion: 'success' }] };
  const failed = { jobs: [{ name: HANDOFF_JOB, status: 'completed', conclusion: 'skipped' }] };
  const gate = (args, { runs, jobs }) => {
    const output = path.join(directory, `output-${Math.random()}`);
    writeFileSync(output, '');
    const fixture = {
      'repos/owner/app/actions/workflows/ci.yml/runs': { workflow_runs: runs },
      'repos/owner/app/actions/workflows/deploy.yml/runs': { workflow_runs: [{ id: 50, created_at: at(9), status: 'in_progress' }] },
      ...Object.fromEntries(Object.entries(jobs).map(([id, value]) => [`repos/owner/app/actions/runs/${id}/jobs`, value])),
    };
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./deploy-gate.mjs', import.meta.url)), ...args], {
      encoding: 'utf8',
      env: { PATH: `${directory}${path.delimiter}${process.env.PATH}`, GH_FIXTURE: JSON.stringify(fixture),
        GITHUB_REPOSITORY: 'owner/app', GITHUB_RUN_ID: '50', GITHUB_OUTPUT: output },
    });
    return { status: result.status, output: readFileSync(output, 'utf8'), log: result.stdout + result.stderr };
  };

  it('deploys the commit CI handed over when nothing newer is being tested', () => {
    const result = gate([`--commit=${sha('2')}`], { runs: [ciRun('3', 6), ciRun('2', 3), ciRun('1', 0)], jobs: { 3: failed, 2: passed, 1: passed } });
    assert.equal(result.status, 0, result.log);
    assert.equal(result.output, `deploy=true\ncommit=${sha('2')}\n`);
  });

  it('deploys the newest tested commit when run by hand', () => {
    const result = gate(['--commit='], { runs: [ciRun('3', 6, 'in_progress'), ciRun('2', 3), ciRun('1', 0)], jobs: { 3: failed, 2: passed, 1: passed } });
    assert.equal(result.status, 0, result.log);
    assert.equal(result.output, `deploy=true\ncommit=${sha('2')}\n`);
  });

  it('stops a re-run of a commit a newer one replaced, without waiting', () => {
    const result = gate([`--commit=${sha('1')}`, '--at-once'], { runs: [ciRun('3', 6, 'in_progress'), ciRun('2', 3), ciRun('1', 0)], jobs: { 3: failed, 2: passed, 1: passed } });
    assert.equal(result.status, 0, result.log);
    assert.equal(result.output, `deploy=false\ncommit=${sha('1')}\n`);
  });

  it('fails for a commit CI did not pass, or that is not one', () => {
    const runs = { runs: [ciRun('1', 0)], jobs: { 1: failed } };
    assert.equal(gate([`--commit=${sha('1')}`], runs).status, 1);
    assert.equal(gate(['--commit=main'], runs).status, 1);
  });
});
