import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./smoke-url.sh', import.meta.url));

async function smoke(t, { image = 'https://delivery.example/og.png', ready = true, cache = 'no-store', type = 'image/png' } = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    requests.push(path);
    if (path === '/') {
      response.setHeader('Cache-Control', cache);
      response.end(`<script src="/_next/static/app.js"></script><meta property="og:image" content="${image}"/>`);
    } else if (path === '/health' || path === '/health/live') {
      const ok = path === '/health/live' || ready;
      response.statusCode = ok ? 200 : 503;
      response.end(JSON.stringify({ ok }));
    } else if (path === '/og.png') {
      response.setHeader('Content-Type', type);
      response.end('image fixture');
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const { stdout } = await run('bash', [script, `http://127.0.0.1:${server.address().port}`], {
    env: { ...process.env, SMOKE_EXPECT_READY: String(ready), CF_ACCESS_CLIENT_ID: '', CF_ACCESS_CLIENT_SECRET: '' },
    timeout: 10_000,
  });
  assert.match(stdout, /Origin smoke passed/);
  assert.deepEqual(requests, ['/', '/health/live', '/health', '/og.png']);
}

test('smoke accepts an unversioned social image and a ready origin', (t) => smoke(t));
test('smoke accepts a versioned social image and the unconfigured CI container', (t) => smoke(t, {
  image: 'https://delivery.example/og.png?v=8bd21a86', ready: false,
}));
test('smoke explains missing social image metadata', async (t) => {
  await assert.rejects(smoke(t, { image: '' }), (error) => {
    assert.match(error.stderr, /social image metadata is missing or invalid/);
    return true;
  });
});
test('smoke still rejects cached pages', async (t) => {
  await assert.rejects(smoke(t, { cache: 'public, max-age=3600' }), (error) => {
    assert.match(error.stderr, /the page must not be cached/);
    return true;
  });
});
test('smoke still rejects non-PNG image responses', async (t) => {
  await assert.rejects(smoke(t, { type: 'text/html' }), (error) => {
    assert.match(error.stderr, /the social image must be a PNG/);
    return true;
  });
});
