// Exercise the real standalone server and Next signal handlers against a fake
// database. No carrier requests, production data or Sentry events are involved.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(resolve(root, '.next/required-server-files.json'), 'utf8')).config;
const job = { id: '97000000-0000-0000-0000-000000000003', kind: 'scheduled', state: 'queued', attempts: 0 };
let owner;
let holdLookup = true;
let lookupStarted = false;
let releases = 0;
const claims = [];
const children = [];
const db = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const args = body ? JSON.parse(body) : {};
  const url = new URL(req.url, 'http://test');
  const reply = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname.endsWith('/claim_sync_job')) {
    if (job.state !== 'queued') return reply([]);
    assert.equal(args.p_lease_seconds, 90);
    owner = args.p_worker_id;
    claims.push(owner);
    job.state = 'running'; job.attempts++;
    return reply([{ ...job }]);
  }
  if (url.pathname.endsWith('/release_sync_job')) {
    assert.equal(args.p_worker_id, owner);
    job.state = 'queued'; job.attempts--; releases++;
    return reply(true);
  }
  if (url.pathname.endsWith('/finish_sync_job')) {
    assert.equal(args.p_worker_id, owner);
    assert.equal(args.p_error, null);
    job.state = 'succeeded';
    return reply(true);
  }
  if (url.pathname === '/rest/v1/packages' && req.method === 'GET') {
    lookupStarted = true;
    if (holdLookup) return; // Simulate an in-flight operation that ignores abort.
  }
  if (url.pathname.endsWith('/maintain_tracking_sync_audit')) return reply([{ abandoned: 0, purged: 0 }]);
  return reply([]);
});
await new Promise(resolve => db.listen(0, '127.0.0.1', resolve));
async function waitFor(predicate, message, timeout = 12_000) {
  const expires = Date.now() + timeout;
  while (Date.now() < expires) { if (await predicate()) return; await delay(50); }
  throw new Error(message);
}
async function start() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [resolve(root, '.next/standalone/server.js')], {
    cwd: root, env: { PATH: process.env.PATH, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      SUPABASE_URL: `http://127.0.0.1:${db.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-service',
      SUPABASE_PUBLISHABLE_KEY: 'test-public', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  children.push(child);
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Server exited during startup: ${output}`);
    return fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false);
  }, 'Server failed readiness');
  if (config.deploymentId) {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.match(await response.text(), new RegExp(`data-dpl-id="${config.deploymentId}"`));
    const navigation = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { RSC: '1', 'x-deployment-id': 'previous-deployment' },
    });
    assert.equal(navigation.headers.get('x-nextjs-deployment-id'), config.deploymentId);
    await navigation.arrayBuffer();
  }
  return { child, output: () => output };
}
async function stop(child) {
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'Shutdown stalled', 9_000);
  const [code, signal] = await exited;
  assert.equal(signal, null);
  assert.equal(code, 143); // Next performed its normal HTTP drain and exit.
}
try {
  const first = await start();
  await waitFor(() => lookupStarted, 'Worker did not start the held operation');
  await stop(first.child);
  assert.equal(releases, 1);
  assert.equal(job.state, 'queued');
  assert.equal(job.attempts, 0);
  assert.match(first.output(), /background_services_drained/);
  holdLookup = false;
  const second = await start();
  await waitFor(() => job.state === 'succeeded', 'Replacement failed to complete handed-off work');
  assert.equal(claims.length, 2);
  assert.notEqual(claims[0], claims[1]);
  await stop(second.child);
  console.log('Deployment recovery passed: active work handed off, then completed by a fresh standalone server.');
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  db.closeAllConnections();
  await new Promise(resolve => db.close(resolve));
}
