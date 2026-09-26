import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SfExpressSessions, sfExpressSessionNumber, sfExpressImageUrl, sfExpressPngSize,
  sfExpressDragPlan, decodeSfExpressPng } from './sf-express-session.mjs';

const NUMBER = 'SF0000000000001';
const OTHER = 'SF0000000000002';
const pageUrl = number => `https://htm.sf-express.com/tw/en/dynamic_function/waybill/#search/bill-number/${number}`;
const api = number => `https://htm.sf-express.com/sf-service-core-web/service/bills/${number}/routes`;
const requestUrl = number => `${api(number)}?lang=en&region=tw&translate=&app=bill`;
const capture = { captureResponses: [api(NUMBER)] };
const body = number => JSON.stringify({ code: 0, result: [{ id: number, routes: [{ scanDateTime: '2026-01-02 03:04:05', remark: 'Collected' }] }] });

function fixture(options = {}) {
  const page = new EventEmitter(), contexts = [], replacements = [];
  let policies = 0, navigations = 0, solves = 0;
  page.goto = async () => { navigations++; await options.navigation; return { status: () => options.navigationStatus ?? 200 }; };
  page.content = async () => '<html>Official tracking page</html>';
  const context = { async newPage() { return page; }, closeCount: 0,
    async close() { this.closeCount++; await options.close; } };
  const browser = { async newContext() { await options.setup; contexts.push(context); return context; } };
  const emit = (spec = {}) => {
    const req = { url: () => spec.url ?? requestUrl(NUMBER), method: () => spec.method ?? 'GET' };
    page.emit('request', req);
    if (spec.networkError) { page.emit('requestfailed', req); return; }
    page.emit('response', { request: () => spec.stale ? {} : req, url: () => req.url(),
      status: () => spec.status ?? 200, headers: () => ({ 'content-type': 'application/json', ...spec.headers }),
      async body() { await spec.read; return Buffer.from(spec.body ?? body(NUMBER)); } });
  };
  const sessions = new SfExpressSessions({ closeMs: 10, solve: async (_, state) => {
    solves++; await options.solve?.({ emit, state }); if (!options.solve) emit(options.reply);
  } });
  const run = (extra = {}) => sessions.run({ url: pageUrl(NUMBER), handle: { browser,
    requestBrowserReplacement: reason => replacements.push(reason) }, tier: 3, maxTimeout: 200,
    capture, installPolicy: async () => { policies++; }, ...extra });
  return { run, emit, contexts, context, page, replacements, counts: () => ({ policies, navigations, solves }) };
}

test('opt-in binds one number to exact public page and capture target', () => {
  assert.equal(sfExpressSessionNumber(pageUrl(NUMBER), capture), NUMBER);
  assert.equal(sfExpressSessionNumber(pageUrl('000000000001'), { captureResponses: [api('000000000001')] }), '000000000001');
  for (const url of [pageUrl(NUMBER).replace('https:', 'http:'), pageUrl(NUMBER).replace('/tw/', '/hk/'),
    pageUrl(NUMBER).replace('#', '?extra=1#'), pageUrl(NUMBER).replace(NUMBER, `${NUMBER},${OTHER}`),
    pageUrl(NUMBER).replace('htm.', 'htm.sf-express.com@evil.'), pageUrl(NUMBER).replace(NUMBER, 'SFIDP0000000001')]) {
    assert.equal(sfExpressSessionNumber(url, capture), null);
  }
  assert.equal(sfExpressSessionNumber(pageUrl(NUMBER), { captureResponses: [api(OTHER)] }), null);
  assert.equal(sfExpressSessionNumber(pageUrl(NUMBER), { captureResponses: [api(NUMBER), '*'] }), null);
});

test('preserves exact route response after applying outbound policy and closes isolated context', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.status, 'success');
  assert.equal(result.capturedResponses[0].body, body(NUMBER));
  assert.equal(result.capturedResponses[0].url, requestUrl(NUMBER));
  assert.deepEqual(result.cookies, []);
  assert.deepEqual(f.counts(), { policies: 1, navigations: 1, solves: 1 });
  assert.equal(f.context.closeCount, 1);
  assert.equal(f.page.listenerCount('response'), 0);
});

test('an automatically arriving route response cancels widget waiting without aborting body reading', async () => {
  let solverSignal;
  const f = fixture({ solve: ({ emit, state }) => {
    solverSignal = state.signal;
    setImmediate(() => emit());
    return new Promise(() => {});
  } });
  const result = await f.run();
  assert.equal(result.status, 'success');
  assert.equal(result.capturedResponses[0].body, body(NUMBER));
  assert.equal(solverSignal.aborted, true);
  assert.equal(result.statusCode, 200);
});

test('preserves the actual main document status alongside the captured API response', async () => {
  const f = fixture({ navigationStatus: 503 });const result = await f.run();
  assert.equal(result.statusCode, 503);
  assert.equal(result.capturedResponses[0].body, body(NUMBER));
});

test('returns provider negative and challenge envelopes unchanged for adapter classification', async () => {
  for (const payload of [{ code: 0, result: [] }, { code: 70000, result: null, message: 'Verification needed' }]) {
    const raw = JSON.stringify(payload); const f = fixture({ reply: { body: raw } });
    assert.equal((await f.run()).capturedResponses[0].body, raw);
  }
});

test('wrong shipment and ambiguous result lists do not establish successful retrieval', async () => {
  for (const raw of [body(OTHER), JSON.stringify({ code: 0, result: [{ id: NUMBER }, { id: OTHER }] })]) {
    const f = fixture({ reply: { body: raw } }); assert.equal((await f.run()).status, 'error');
    assert.equal(f.context.closeCount, 1);
  }
});

test('ignores unrelated, malformed, stale, and wrong-method responses before its own request', async () => {
  const f = fixture({ solve: ({ emit }) => {
    emit({ url: requestUrl(OTHER) }); emit({ url: requestUrl(NUMBER) + '&extra=true' });
    emit({ url: requestUrl(NUMBER).replace('region=tw', 'region=cn') });
    emit({ method: 'POST' }); emit({ stale: true, body: 'untrusted stale response' }); emit();
  } });
  assert.equal((await f.run()).capturedResponses[0].body, body(NUMBER));
});

test('widget completion without actual route response exhausts budget and cleans listeners', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = fixture({ solve: async () => {} }); const running = f.run({ maxTimeout: 40 });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(40);
  const result = await running;
  assert.equal(result.status, 'error');
  assert.equal(result.durationMs, 40);
  assert.equal(f.context.closeCount, 1); assert.equal(f.page.listenerCount('response'), 0);
});

test('network, malformed JSON and oversized replies fail without retries', async () => {
  for (const reply of [{ networkError: true }, { body: '{}' }, { body: 'broken' },
    { headers: { 'content-length': '2000001' } }, { body: ' '.repeat(2_000_001) },
    { headers: { 'content-type': 'text/html' } }]) {
    const f = fixture({ reply }); assert.equal((await f.run()).status, 'error');
    assert.equal(f.counts().solves, 1); assert.equal(f.context.closeCount, 1);
  }
});

test('caller cancellation interrupts a hanging image/solver operation and closes context', async () => {
  let observed;
  const f = fixture({ solve: ({ state }) => { observed = state.signal; return new Promise(() => {}); } });
  const controller = new AbortController();const running = f.run({ signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));controller.abort();
  assert.equal((await running).status, 'error');assert.equal(observed.aborted, true);
  assert.equal(f.context.closeCount, 1);assert.equal(f.page.listenerCount('response'), 0);
});

test('body reads and cleanup cannot extend the total lookup indefinitely', async () => {
  const f = fixture({ reply: { read: new Promise(() => {}) }, close: new Promise(() => {}) });
  const began = Date.now();assert.equal((await f.run({ maxTimeout: 45 })).status, 'error');
  assert.ok(Date.now() - began < 2_000);assert.ok(f.replacements.length > 0);
});

test('late context creation is closed and never navigates after timeout', async () => {
  let release;const f = fixture({ setup: new Promise(resolve => { release = resolve; }) });
  assert.equal((await f.run({ maxTimeout: 35 })).status, 'error');assert.ok(f.replacements.length > 0);
  release();await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.context.closeCount, 1);assert.equal(f.counts().navigations, 0);
});

test('busy browser cannot run overlapping isolated lookups', async () => {
  const f = fixture({ solve: () => new Promise(() => {}) });const a = f.run({ maxTimeout: 40 });
  assert.match((await f.run()).reason, /busy/);await a;
});

test('asset allowlist rejects alternative hosts, redirects, credentials, types and query strings', () => {
  const url = 'https://static.geetest.com/pictures/v4_pic/slide_2024_09_02/group/bg/00000000000000000000000000000000.png';
  assert.equal(sfExpressImageUrl(url, 'bg'), url);
  for (const changed of [url.replace('https:', 'http:'), url + '?redirect=x', url.replace('.com/', '.com.evil/'),
    url.replace('/bg/', '/slide/'), url.replace('.png', '.svg'), url.replace('static.', 'user@static.')]) {
    assert.equal(sfExpressImageUrl(changed, 'bg'), null);
  }
});

test('PNG dimensions are bounded before invoking any decoder', () => {
  const png = Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR', 12);
  png.writeUInt32BE(300, 16);png.writeUInt32BE(200, 20);assert.deepEqual(sfExpressPngSize(png), { width: 300, height: 200 });
  for (const bytes of [Buffer.alloc(10), Buffer.alloc(262_145), Buffer.alloc(40)]) assert.throws(() => sfExpressPngSize(bytes));
  png.writeUInt32BE(10000, 16);assert.throws(() => sfExpressPngSize(png));
});

test('drag plan uses rendered image scale and whole tile origin, never alpha inset', () => {
  const widget = { background: { x: 100, y: 100, width: 151, cssWidth: 300, borderLeft: 1 },
    slice: { x: 100.5, width: 40 }, handle: { x: 100, y: 300, width: 40, height: 20 }, handleReady: true };
  const result = sfExpressDragPlan(widget, { width: 300 }, { accepted: true, x: 150 });
  assert.equal(result.target, 175.5);assert.equal(result.distance, 75);
  assert.throws(() => sfExpressDragPlan({ ...widget, handleReady: false }, { width: 300 }, { accepted: true, x: 150 }));
  assert.throws(() => sfExpressDragPlan(widget, { width: 300 }, { accepted: false, x: 150 }));
});


test('deadline abort kills an active image decoder process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sf-decoder-test-'));
  const executable = join(directory, 'decoder.cjs'), pidFile = join(directory, 'pid');
  const oldCommand = process.env.FFMPEG_PATH;
  const controller = new AbortController();
  let pid;
  try {
    await writeFile(executable, '#!' + process.execPath + '\n' +
      'require("node:fs").writeFileSync(' + JSON.stringify(pidFile) + ', String(process.pid));\n' +
      'process.stdin.resume();setInterval(() => {}, 1000);\n', { mode: 0o700 });
    process.env.FFMPEG_PATH = executable;
    const png = Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR', 12);
    png.writeUInt32BE(1, 16);png.writeUInt32BE(1, 20);
    const decoding = decodeSfExpressPng(png, controller.signal);
    const outcome = assert.rejects(decoding, /decoding failed/);
    for (let attempt = 0; attempt < 100; attempt++) {
      try { pid = Number(await readFile(pidFile, 'utf8')); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(pid > 0, 'decoder process started');
    controller.abort();
    await outcome;
    let exited = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { process.kill(pid, 0); } catch { exited = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(exited, true);
  } finally {
    controller.abort();
    if (oldCommand === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = oldCommand;
    await rm(directory, { recursive: true, force: true });
  }
});
