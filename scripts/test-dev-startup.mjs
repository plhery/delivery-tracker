import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Test the HTTP response, not Next's "Ready" log: instrumentation compilation
// used to fail only when the first page was requested. Never start live workers.
const root = fileURLToPath(new URL('../', import.meta.url));
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const { port } = reservation.address();
await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
const child = spawn(process.execPath, [
  'node_modules/next/dist/bin/next', 'dev', '--webpack',
  '--hostname', '127.0.0.1', '--port', String(port),
], {
  cwd: root,
  env: {
    ...process.env,
    CI: 'true',
    NODE_ENV: 'development',
    NEXT_PUBLIC_USE_API: 'false',
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SENTRY_DSN: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
const remember = (chunk) => { output = (output + chunk).slice(-16_000); };
child.stdout.on('data', remember);
child.stderr.on('data', remember);
const exited = once(child, 'exit');

try {
  const deadline = Date.now() + 60_000;
  let response;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, `Development server exited early:\n${output}`);
    try {
      response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      await delay(250);
      continue;
    }
    assert.equal(response.status, 200, `Development page returned ${response.status}:\n${output}`);
    const html = await response.text();
    assert.match(html, /<html/i);
    console.log('Development server compiled and served the app successfully.');
    break;
  }
  assert.ok(response, `Development server did not respond:\n${output}`);
} finally {
  child.kill('SIGTERM');
  const forceStop = setTimeout(() => child.kill('SIGKILL'), 5_000);
  forceStop.unref();
  await exited;
  clearTimeout(forceStop);
}
