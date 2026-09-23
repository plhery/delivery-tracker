import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { FedExSessions, fedexSessionNumber } from './fedex-session.mjs';

const API = 'https://api.fedex.com/track/v2/shipments';
const NUMBER = '999999999999';
const OTHER = '999999999998';
const capture = { captureResponses: [API] };
const url = number => `https://www.fedex.com/fedextrack/?trknbr=${number}`;
const payload = number => JSON.stringify({ output: { packages: [{ trackingNbr: number, keyStatus: 'Delivered' }] } });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(replies = [], settings = {}) {
  const browser = new EventEmitter();
  const contexts = [], requests = [], replacements = [];
  let policies = 0, navigations = 0;
  browser.newContext = async () => {
    const page = new EventEmitter();
    const context = { closed: false, async close() { this.closed = true; }, async newPage() { return page; } };
    contexts.push(context);
    page.isClosed = () => context.closed;
    page.goto = async target => { navigations++; assert.equal(target, 'https://www.fedex.com/fedextrack/'); };
    page.content = async () => '<html><body>Tracking</body></html>';
    let entered, opened = false;
    page.locator = () => ({ first: () => ({
      fill: async number => { entered = number; },
      inputValue: async () => entered,
      isVisible: async () => opened,
    }) });
    page.getByRole = (_, { name }) => {
      const act = async () => {
      if (name === 'Track Another Shipment') { opened = true; return; }
      if (!(name instanceof RegExp)) return;
      const spec = replies.shift() ?? {};
      const request = number => ({ url: () => API, method: () => 'POST',
        postDataJSON: () => ({ trackingInfo: [{ trackNumberInfo: { trackingNumber: number } }] }) });
      const response = (req, body) => ({ request: () => req,
        status: () => spec.status ?? 200,
        headers: () => ({ 'content-type': 'application/json', ...spec.headers }),
        body: async () => { await spec.bodyGate; return Buffer.from(body); },
      });
      requests.push(entered);
      const req = request(entered);
      if (spec.stale) page.emit('response', response(request(entered), 'stale response'));
      page.emit('request', req);
      if (spec.unrelated) {
        const unrelated = request(OTHER);
        page.emit('request', unrelated);
        page.emit('response', response(unrelated, payload(OTHER)));
      }
      page.emit('response', response(req, spec.body ?? payload(entered)));
      opened = false;
      };
      return { evaluate: act, click: async () => {
        if (settings.mouseStallsBeforeSubmit && name instanceof RegExp) throw new Error('Mouse stalled');
        if (settings.mouseStallsBeforeMenu && name === 'Track Another Shipment') throw new Error('Mouse stalled');
        await act();
        if (settings.mouseStallsAfterSubmit && name instanceof RegExp) throw new Error('Mouse stalled');
      } };
    };
    return context;
  };
  const sessions = settings.sessions ?? new FedExSessions(settings);
  const handle = { browser, requestBrowserReplacement: reason => replacements.push(reason) };
  const run = (number = NUMBER, options = {}) => sessions.run({ url: url(number), handle, tier: 3,
    maxTimeout: 1000, capture, installPolicy: async () => { policies++; }, ...options });
  const close = async () => { browser.emit('disconnected'); await tick(); };
  return { browser, contexts, requests, replacements, run, close, policies: () => policies, navigations: () => navigations };
}

test('session route requires the exact FedEx page, one number and one capture endpoint', () => {
  assert.equal(fedexSessionNumber(url(NUMBER), capture), NUMBER);
  assert.equal(fedexSessionNumber(url(NUMBER).replace('/fedextrack/', '/wtrk/track/'), capture), NUMBER);
  for (const candidate of [url(NUMBER).replace('www.fedex.com', 'other.test'),
    url(NUMBER).replace('/fedextrack/', '/other/'), url('wrong'), url(NUMBER) + '&trknbr=' + OTHER]) {
    assert.equal(fedexSessionNumber(candidate, capture), null);
  }
  assert.equal(fedexSessionNumber(url(NUMBER), { captureResponses: [API, 'https://other.test'] }), null);
  assert.equal(fedexSessionNumber(url(NUMBER)), null);
});

test('keeps a verified context across tiers and makes a new request for each number', async () => {
  const f = fixture([{}, { unrelated: true }]);
  const cold = await f.run();
  const warm = await f.run(OTHER, { tier: 2 });
  assert.equal(cold.reason, 'fedex-session-new');
  assert.equal(warm.reason, 'fedex-session-reused');
  assert.equal(warm.tier, 2);
  assert.deepEqual(f.requests, [NUMBER, OTHER]);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.policies(), 1);
  assert.equal(f.navigations(), 2);
  assert.equal(JSON.parse(warm.capturedResponses[0].body).output.packages[0].trackingNbr, OTHER);
  assert.deepEqual(warm.cookies, []);
  await f.close();
  assert.equal(f.contexts[0].closed, true);
});

test('ignores a response for another submitted number', async () => {
  const f = fixture([{ unrelated: true }]);
  const result = await f.run();
  assert.equal(JSON.parse(result.capturedResponses[0].body).output.packages[0].trackingNbr, NUMBER);
  await f.close();
});

test('ignores a late response for the same number from an earlier request', async () => {
  const f = fixture([{}, { stale: true }]);
  await f.run();
  const result = await f.run();
  assert.equal(result.capturedResponses[0].body, payload(NUMBER));
  assert.equal(result.reason, 'fedex-session-reused');
  await f.close();
});

test('refreshes the same number through the blank form without replacing its context', async () => {
  const f = fixture();
  await f.run();
  assert.equal((await f.run()).reason, 'fedex-session-reused');
  assert.equal(f.contexts.length, 1);
  assert.equal(f.navigations(), 2);
  assert.deepEqual(f.requests, [NUMBER, NUMBER]);
  await f.close();
});

for (const spec of [
  { status: 403 },
  { status: 429, headers: { 'retry-after': '120' } },
  { body: payload(OTHER) },
  { body: '{invalid' },
  { body: JSON.stringify({ output: { packages: [] } }) },
  { headers: { 'content-length': '2000001' } },
]) test(`discards an unverified session and preserves its reply: ${JSON.stringify(spec)}`, async () => {
  const f = fixture([{}, spec, {}]);
  await f.run();
  const rejected = await f.run();
  assert.equal(f.contexts[0].closed, true);
  assert.equal(rejected.capturedResponses[0].status, spec.status ?? 200);
  if (spec.headers?.['retry-after']) assert.equal(rejected.capturedResponses[0].headers['retry-after'], '120');
  assert.equal((await f.run()).reason, 'fedex-session-new');
  assert.equal(f.contexts.length, 2);
  await f.close();
});

test('expires idle contexts and removes their browser listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fixture([], { idleMs: 50 });
  await f.run();
  assert.equal(f.browser.listenerCount('disconnected'), 1);
  t.mock.timers.tick(51);
  await tick();
  assert.equal(f.contexts[0].closed, true);
  assert.equal(f.browser.listenerCount('disconnected'), 0);
  assert.equal((await f.run()).reason, 'fedex-session-new');
  await f.close();
});

test('successful activity does not extend the maximum session age', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fixture([], { idleMs: 100, maxAgeMs: 150 });
  await f.run();
  t.mock.timers.tick(80);
  assert.equal((await f.run()).reason, 'fedex-session-reused');
  t.mock.timers.tick(71);
  await tick();
  assert.equal(f.contexts[0].closed, true);
  assert.equal((await f.run()).reason, 'fedex-session-new');
  await f.close();
});

test('rejects overlapping calls without disturbing the active session', async () => {
  let release;
  const f = fixture([{ bodyGate: new Promise(resolve => { release = resolve; }) }]);
  const active = f.run();
  await tick();
  assert.equal((await f.run()).reason, 'FedEx browser session is busy');
  release();
  assert.equal((await active).capturedResponses[0].status, 200);
  assert.equal((await f.run()).reason, 'fedex-session-reused');
  await f.close();
});

test('a budget timeout closes the context and cannot leave a reusable session', async () => {
  const f = fixture([{ bodyGate: new Promise(() => {}) }]);
  assert.equal((await f.run(NUMBER, { maxTimeout: 20 })).status, 'error');
  assert.equal(f.contexts[0].closed, true);
  assert.equal((await f.run()).reason, 'fedex-session-new');
  await f.close();
});

test('failed cleanup requests browser replacement instead of waiting indefinitely', async () => {
  const f = fixture([{}, { status: 403 }], { closeMs: 10 });
  await f.run();
  f.contexts[0].close = () => new Promise(() => {});
  const result = await f.run();
  assert.equal(result.capturedResponses[0].status, 403);
  assert.deepEqual(f.replacements, ['FedEx session cleanup failed']);
  await f.close();
});

test('a context created after the deadline is closed instead of retained', async () => {
  const f = fixture();
  let finish;
  const context = { closed: false, async close() { this.closed = true; } };
  f.browser.newContext = () => new Promise(resolve => { finish = resolve; });
  assert.equal((await f.run(NUMBER, { maxTimeout: 20 })).status, 'error');
  assert.deepEqual(f.replacements, ['FedEx session setup did not finish']);
  finish(context);
  await tick();
  assert.equal(context.closed, true);
  assert.equal(f.browser.listenerCount('disconnected'), 0);
});

for (const setting of ['mouseStallsBeforeMenu', 'mouseStallsBeforeSubmit', 'mouseStallsAfterSubmit']) {
  test(`recovers a stalled mouse action without duplicate tracking: ${setting}`, async () => {
    const f = fixture([], { [setting]: true });
    assert.equal((await f.run()).capturedResponses[0].status, 200);
    assert.deepEqual(f.requests, [NUMBER]);
    await f.close();
  });
}

test('pool affinity returns to a verified browser and releases rejected affinity', async () => {
  const sessions = new FedExSessions();
  const a = fixture([{ status: 403 }], { sessions });
  const b = fixture([{}, { status: 403 }], { sessions });
  const entries = [{ browser: a.browser }, { browser: b.browser }];
  assert.equal(sessions.preferred(entries, 'www.fedex.com'), entries[0]);
  await a.run();
  assert.equal(sessions.preferred(entries, 'www.fedex.com'), entries[1]);
  await b.run();
  assert.equal(sessions.preferred(entries, 'www.fedex.com'), entries[1]);
  await b.run();
  assert.equal(sessions.preferred(entries, 'www.fedex.com'), entries[0]);
  assert.equal(sessions.preferred(entries, 'other.test'), undefined);
  await a.close(); await b.close();
});
