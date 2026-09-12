import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachTrackingCapture } from './tracking-capture.mjs';
const api = 'https://t.17track.net/track/restapi';
const number = 'ZZ12345678900';
const reply = code => JSON.stringify({ meta: { code: 200 }, shipments: [{ number, code }] });
const upsApi = 'https://webapis.ups.com/track/api/Track/GetStatus?loc=en_US';
// A made-up number in UPS's published format, the same one the adapter's tests use.
const upsNumber = '1Z999AA10123456784';
const upsUrl = `https://www.ups.com/track?loc=en_US&tracknum=${upsNumber}&requester=ST%2Ftrackdetails`;
const upsReply = (trackingNumber = upsNumber, statusCode = '200') => JSON.stringify({ statusCode, trackDetails: [{ trackingNumber }] });
async function fixture(url = `https://t.17track.net/en#nums=${number}`, endpoint = api) {
  let handler;
  let detached = false;
  const page = { on: (_, fn) => { handler = fn; }, off: () => { detached = true; } };
  const capture = await attachTrackingCapture(page, url, { captureResponses: [endpoint] });
  const respond = (body, { url = endpoint, headers = {}, status = 200, read } = {}) => handler({
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

test('reads the decoded UPS status reply and finishes on the requested shipment', async () => {
  const { capture, respond } = await fixture(upsUrl, upsApi);
  let settled = false;
  const waiting = capture.settle(1000).then(() => { settled = true; });
  await respond(upsReply('1Z000AA10000000000')); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(settled, false);
  await respond(upsReply()); await waiting;
  const rows = (await capture.drain()).capturedResponses;
  assert.deepEqual(rows.map(row => JSON.parse(row.body).trackDetails[0].trackingNumber), ['1Z000AA10000000000', upsNumber]);
});

test('finishes on a rejected UPS status envelope and only serves one valid number per page', async () => {
  const { capture, respond } = await fixture(upsUrl, upsApi);
  await respond(upsReply(upsNumber, '500'));
  await capture.settle(1000);
  assert.equal((await capture.drain()).capturedResponses.length, 1);
  for (const [url, endpoint] of [
    ['https://www.ups.com/track?loc=en_US&tracknum=not-a-ups-number', upsApi],
    ['https://www.ups.com/track/details?tracknum=' + upsNumber, upsApi],
    [upsUrl, api],
    [`https://t.17track.net/en#nums=${number}`, upsApi],
  ]) {
    assert.equal(await attachTrackingCapture({}, url, { captureResponses: [endpoint] }), undefined);
  }
});
