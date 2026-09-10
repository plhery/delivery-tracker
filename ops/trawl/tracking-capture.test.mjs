import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachTrackingCapture } from './tracking-capture.mjs';
const api = 'https://t.17track.net/track/restapi';
const number = 'ZZ12345678900';
const reply = code => JSON.stringify({ meta: { code: 200 }, shipments: [{ number, code }] });
async function fixture() {
  let handler;
  let detached = false;
  const page = { on: (_, fn) => { handler = fn; }, off: () => { detached = true; } };
  const capture = await attachTrackingCapture(page, `https://t.17track.net/en#nums=${number}`, { captureResponses: [api] });
  const respond = (body, { url = api, headers = {}, status = 200, read } = {}) => handler({
    url: () => url, status: () => status,
    headers: () => ({ 'content-type': 'application/json', 'content-length': String(body.length), 'content-encoding': 'gzip', ...headers }),
    body: read ?? (async () => Buffer.from(body)),
  });
  return { capture, respond, detached: () => detached };
}

test('reads decoded compressed history and waits through polling for a final matching reply', async () => {
  const { capture, respond } = await fixture();
  let settled = false;
  const waiting = capture.settle(1000).then(() => { settled = true; });
  await respond(reply(100)); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(settled, false);
  await respond(reply(200)); await waiting;
  assert.deepEqual((await capture.drain()).capturedResponses.map(r => JSON.parse(r.body).shipments[0].code), [100, 200]);
});

test('ignores unrelated endpoints and rejects oversized declared and decoded bodies', async () => {
  const { capture, respond } = await fixture();
  await respond(reply(200), { url: 'https://unrelated.example/track/restapi' });
  await respond(reply(200), { headers: { 'content-length': '2000001' }, read: () => { throw new Error('must not read'); } });
  await respond('x'.repeat(2_000_001), { headers: { 'content-length': '1000' } });
  const rows = (await capture.drain()).capturedResponses;
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.body === null && row.error));
  assert.equal(rows[1].truncated, true);
});

test('rate limits finish immediately and preserve Retry-After without cookies', async () => {
  const { capture, respond } = await fixture();
  await respond('', { status: 429, headers: { 'retry-after': '300', cookie: 'PRIVATE' } });
  await capture.settle(1000);
  const result = await capture.drain();
  assert.equal(result.capturedResponses[0].headers['retry-after'], '300');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('bounds hanging body reads and detaches without accepting late replies', async () => {
  const { capture, respond, detached } = await fixture();
  let release;
  const reading = respond(reply(200), { read: () => new Promise(resolve => { release = resolve; }) });
  await capture.settle(1); const snapshot = await capture.drain();
  release(Buffer.from(reply(200))); await reading;
  assert.equal(snapshot.capturedResponses[0].body, null);
  assert.equal(detached(), true);
});

test('does not finish on a demo or alter other providers and multi-number lookups', async () => {
  const { capture, respond } = await fixture();
  await respond(reply(200).replace(number, 'TestNumber00017'));
  await capture.settle(1);
  for (const url of ['https://parcelsapp.com/en/tracking/ZZ12345678900', 'https://t.17track.net/en#nums=ZZ12345,ZZ54321']) {
    assert.equal(await attachTrackingCapture({}, url, { captureResponses: [api] }), undefined);
  }
});
