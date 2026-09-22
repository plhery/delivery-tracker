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
const fedexApi = 'https://api.fedex.com/track/v2/shipments';
// A made-up number in FedEx's published format, the same one the adapter's tests use.
const fedexNumber = '999999999999';
const fedexUrl = `https://www.fedex.com/wtrk/track/?trknbr=${fedexNumber}`;
const fedexReply = (trackingNbr = fedexNumber) => JSON.stringify({ output: { packages: [{ trackingNbr }] } });
async function fixture(url = `https://t.17track.net/en#nums=${number}`, endpoint = api, additional = []) {
  const handlers = {};
  let detached = false;
  const page = { context: () => ({addCookies: async () => {}}), on: (event, fn) => { handlers[event] = fn; }, off: () => { detached = true; } };
  const capture = await attachTrackingCapture(page, url, { captureResponses: [endpoint, ...additional] });
  const respond = (body, { url = endpoint, headers = {}, status = 200, method = 'GET', read } = {}) => handlers.response({
    url: () => url, status: () => status, request: () => ({method: () => method}),
    headers: () => ({ 'content-type': 'application/json', 'content-length': String(body.length), 'content-encoding': 'gzip', ...headers }),
    body: read ?? (async () => Buffer.from(body)),
  });
  return { page, capture, respond, handlers, detached: () => detached };
}

const ninjaGet = 'https://postal.ninja/track/get';
const ninjaCheck = 'https://postal.ninja/track/check';
const ninjaUrl = `https://postal.ninja/en/tools#trawl-number=${number}`;
const ninjaReply = (fields = {}) => JSON.stringify({status: 'FOUND', hid: 'test-handle', track: {tc: number, hid: 'test-handle', state: 'FINISHED'}, ...fields});

test('Postal Ninja requires an exact tools page, one number and both capture endpoints', async () => {
  for (const url of [ninjaUrl.replace('postal.ninja', 'other.test'), ninjaUrl.replace('/en/tools', '/en'),
    ninjaUrl.replace('#trawl-number=', '?trawl-number='), ninjaUrl + ',OTHER123', ninjaUrl.replace(number, 'LETTERS')]) {
    assert.equal(await attachTrackingCapture({}, url, {captureResponses: [ninjaGet, ninjaCheck]}), undefined);
  }
  assert.equal(await attachTrackingCapture({}, ninjaUrl, {captureResponses: [ninjaGet]}), undefined);
});

test('Postal Ninja waits through processing and pending replies for the exact completed lookup', async () => {
  const { capture, respond } = await fixture(ninjaUrl, ninjaGet, [ninjaCheck]);
  const post = (body, url = ninjaGet) => respond(body, {url, method: 'POST'});
  let settled = false;
  const waiting = capture.settle(1000).then(() => { settled = true; });
  await respond(ninjaReply()); // GET is not the widget protocol.
  await post(JSON.stringify({status: 'PROCESSING', tc: number, hid: 'test-handle'}), ninjaCheck);
  assert.equal(capture.hasTrackingRequest(), true);
  await post(ninjaReply({inProgress: true}));
  await post(ninjaReply({track: {tc: 'OTHER123', hid: 'test-handle'}}));
  await post(ninjaReply({hid: 'mismatched'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(settled, false);
  await post(ninjaReply()); await waiting;
  assert.equal(capture.hasResponse(), true);
  const rows = (await capture.drain()).capturedResponses;
  assert.equal(rows.length, 5);
  assert.equal(rows[0].url, ninjaCheck);
});

test('Postal Ninja finishes matching challenges and completed empty replies promptly', async () => {
  for (const final of [JSON.stringify({status: 'CHLNG_REQ', hid: 'test-handle'}), JSON.stringify({status: 'UNTRACEABLE', tc: number}), ninjaReply({track: {tc: number, hid: 'test-handle', state: 'NO_INFO'}})]) {
    const { capture, respond } = await fixture(ninjaUrl, ninjaGet, [ninjaCheck]);
    await respond(JSON.stringify({status: 'CHLNG_REQ', tc: 'OTHER123'}), {url: ninjaCheck, method: 'POST'});
    assert.equal(capture.hasResponse(), false);
    await respond(JSON.stringify({status: 'PROCESSING', tc: number, hid: 'test-handle'}), {url: ninjaCheck, method: 'POST'});
    await respond(JSON.stringify({status: 'CHLNG_REQ', hid: 'unrelated'}), {method: 'POST'});
    assert.equal(capture.hasResponse(), false);
    await respond(final, {method: 'POST'});
    assert.equal(capture.hasResponse(), true);
    await capture.settle(1000); await capture.drain();
  }
});

test('Postal Ninja opens only the verified result and waits for full history after compact capture', async () => {
  const {page, capture, respond} = await fixture(ninjaUrl, ninjaGet, [ninjaCheck]);
  let filled;
  let saved = true;
  let submitted = 0;
  let navigated;
  const post = body => respond(body, {method: 'POST'});
  const compact = ninjaReply({track: {tc: number, hid: 'test-handle', state: 'FINISHED', firstEv: {dt: '2026-08-01T10:00:00', dsc: 'Accepted'}}});
  const form = {locator: selector => {
    if (selector === 'input[type="text"]') return {fill: async value => {filled = value;}};
    if (selector === 'input[type="checkbox"]') return {count: async () => 1, uncheck: async () => {saved = false;}};
    return {evaluate: async () => { submitted++; assert.equal(saved, false); await post(compact); return true; }};
  }};
  page.frameLocator = () => ({locator: () => form});
  page.goto = async url => {navigated = url;};
  await capture.prepare(2000);
  assert.equal(filled, number);
  assert.equal(submitted, 1);
  assert.equal(navigated, 'https://postal.ninja/en/track#/test-handle');
  let settled = false;
  const waiting = capture.settle(1000).then(() => {settled = true;});
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(settled, false);
  await post(ninjaReply({track: {tc: number, hid: 'test-handle', state: 'FINISHED', events: [{dt: '2026-08-01T10:00:00', dsc: 'Accepted'}]}}));
  await waiting;
  assert.equal((await capture.drain()).capturedResponses.length, 2);
});

test('Postal Ninja never follows an unsafe or unrelated result handle', async () => {
  for (const [tc, hid] of [[number, '//other.test'], ['OTHER123', 'test-handle']]) {
    const {page, capture, respond} = await fixture(ninjaUrl, ninjaGet, [ninjaCheck]);
    page.frameLocator = () => ({locator: () => ({locator: selector => selector === 'input[type="text"]'
      ? {fill: async () => {}}
      : selector === 'input[type="checkbox"]' ? {count: async () => 0}
        : {evaluate: async () => {await respond(ninjaReply({hid, track: {tc, hid, firstEv: {dt: '2026-08-01T10:00:00'}}}), {method: 'POST'}); return true;}}})});
    page.goto = () => {throw new Error('Must not navigate');};
    await capture.prepare(10);
    await capture.drain();
  }
});

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

test('reads the decoded FedEx tracking reply and finishes on its envelope', async () => {
  const { capture, respond } = await fixture(fedexUrl, fedexApi);
  let settled = false;
  const waiting = capture.settle(1000).then(() => { settled = true; });
  await respond(JSON.stringify({ output: { packages: [] } }));
  await waiting;
  assert.equal(settled, true);
  const rows = (await capture.drain()).capturedResponses;
  assert.deepEqual(rows.map(row => JSON.parse(row.body).output.packages.length), [0]);
});

test('serves the FedEx endpoint from either tracking page path and only for valid numbers', async () => {
  const { capture, respond } = await fixture(`https://www.fedex.com/fedextrack/?trknbr=${fedexNumber}`, fedexApi);
  assert.ok(capture);
  await respond(fedexReply());
  await capture.settle(1000);
  assert.deepEqual((await capture.drain()).capturedResponses.map(row => JSON.parse(row.body).output.packages[0].trackingNbr), [fedexNumber]);
  for (const [url, endpoint] of [
    ['https://www.fedex.com/wtrk/track/?trknbr=not-a-fedex-number', fedexApi],
    ['https://www.fedex.com/wtrk/track/', fedexApi],
    ['https://www.fedex.com/fedextrack/system-error?trknbr=' + fedexNumber, fedexApi],
    [fedexUrl, upsApi],
    [`https://t.17track.net/en#nums=${number}`, fedexApi],
  ]) {
    assert.equal(await attachTrackingCapture({}, url, { captureResponses: [endpoint] }), undefined);
  }
});

const royalMailApiPrefix = 'https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/';
// A made-up number in Royal Mail's published S10 format, the same one the adapter's tests use.
const royalMailNumber = 'SG999999999GB';
const royalMailUrl = `https://www.royalmail.com/track-your-item#/tracking-results/${royalMailNumber}`;
const royalMailApi = `${royalMailApiPrefix}${royalMailNumber}`;
const royalMailReply = (mailPieceId = royalMailNumber) => JSON.stringify({ mailPieceId });

test('reads the decoded Royal Mail summary reply and finishes on its envelope', async () => {
  const { capture, respond } = await fixture(royalMailUrl, royalMailApi);
  assert.ok(capture);
  let settled = false;
  const waiting = capture.settle(1000).then(() => { settled = true; });
  await respond(royalMailReply());
  await waiting;
  assert.equal(settled, true);
  const rows = (await capture.drain()).capturedResponses;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, royalMailApi);
  assert.deepEqual(JSON.parse(rows[0].body).mailPieceId, royalMailNumber);
});

test('serves the Royal Mail endpoint only from its hash route with a valid number', async () => {
  for (const [url, endpoint] of [
    ['https://www.royalmail.com/track-your-item#/tracking-results/not-a-number', `${royalMailApiPrefix}NOT-A-NUMBER`],
    ['https://www.royalmail.com/track-your-item', royalMailApi],
    ['https://www.royalmail.com/track-your-item#/tracking-results/SG999999999GB', upsApi],
    [`https://t.17track.net/en#nums=${number}`, royalMailApi],
  ]) {
    assert.equal(await attachTrackingCapture({}, url, { captureResponses: [endpoint] }), undefined);
  }
});


test('Royal Mail captures only the exact number and rejects unrelated page paths', async () => {
  const { capture, respond } = await fixture(royalMailUrl, royalMailApi);
  await respond(royalMailReply('SG999999998GB'), {url: royalMailApiPrefix + 'SG999999998GB'});
  await respond(royalMailReply(), {url: royalMailApi + '/extra'});
  await assert.rejects(capture.drain(), /no tracking response/);
  for (const [url, endpoint] of [
    [royalMailUrl.replace('/track-your-item', '/other-page'), royalMailApi],
    [royalMailUrl, royalMailApiPrefix + 'SG999999998GB'],
    [royalMailUrl, royalMailApi + '.evil.example'],
  ]) assert.equal(await attachTrackingCapture({}, url, {captureResponses: [endpoint]}), undefined);
});

test('Royal Mail prepares the form after capture attaches and before solving', async () => {
  const calls = [];
  let consentVisible = true;
  const page = {
    context: () => ({addCookies: async () => {}}),
    on: event => { if (event === 'response') calls.push('observe'); },
    waitForEvent: async event => { calls.push(['wait', event]); },
    getByText: () => ({waitFor: async () => {}, isVisible: async () => consentVisible, evaluate: async () => { consentVisible = false; calls.push('decline'); }}),
    locator: selector => ({
      waitFor: async () => {},
      inputValue: async () => royalMailNumber,
      press: async value => calls.push([selector, value]),
      pressSequentially: async value => calls.push(['type', value]),
      evaluate: async () => { calls.push(selector); return true; },
    }),
  };
  const capture = await attachTrackingCapture(page, royalMailUrl, {captureResponses: [royalMailApi]});
  await capture.prepare(1000);
  assert.deepEqual(calls, ['observe', ['wait', 'domcontentloaded'], 'decline', ['#barcode-input', 'ControlOrMeta+A'], ['#barcode-input', 'Backspace'], ['type', royalMailNumber], '#submit:not(:disabled)']);
  await assert.rejects(capture.prepare(0), /timed out/);
});

test('Royal Mail waits for consent reload before typing into the replacement form', async () => {
  let finishReload;
  let loaded = false;
  let value = '';
  let responseHandler;
  let submitted = false;
  const page = {
    context: () => ({addCookies: async () => {}}),
    on: (event, fn) => { if (event === 'response') responseHandler = fn; },
    waitForEvent: () => new Promise(resolve => { finishReload = resolve; }),
    getByText: () => ({
      waitFor: async () => {}, isVisible: async () => true,
      evaluate: async () => { setTimeout(() => { value = ''; loaded = true; finishReload?.(); }, 10); },
    }),
    locator: selector => ({
      waitFor: async () => {}, press: async () => {}, inputValue: async () => value,
      pressSequentially: async text => { assert.equal(loaded, true); value = text; },
      evaluate: async (fn, expected) => fn({
        ownerDocument: { querySelector: () => ({ value }) },
        click() {
          assert.equal(selector, '#submit:not(:disabled)');
          submitted = true;
          responseHandler({url: () => royalMailApi, status: () => 200,
            request: () => ({method: () => 'GET'}), headers: () => ({'content-type': 'application/json'}),
            body: async () => Buffer.from(royalMailReply())});
        },
      }, expected),
    }),
  };
  const capture = await attachTrackingCapture(page, royalMailUrl, {captureResponses: [royalMailApi]});
  await capture.prepare(1000);
  assert.equal(submitted, true);
  assert.equal(capture.hasResponse(), true);
});

test('Royal Mail refuses an empty replacement form when navigation races the final click', async () => {
  let value = royalMailNumber;
  let submitted = false;
  const page = {
    context: () => ({addCookies: async () => {}}),
    on: () => {},
    getByText: () => ({waitFor: async () => {}, isVisible: async () => false}),
    locator: selector => ({
      waitFor: async () => { if (selector === '#submit:not(:disabled)') value = ''; },
      press: async () => {}, pressSequentially: async () => {}, inputValue: async () => value,
      evaluate: async (fn, expected) => fn({
        ownerDocument: {querySelector: () => ({value})}, click() { submitted = true; },
      }, expected),
    }),
  };
  const capture = await attachTrackingCapture(page, royalMailUrl, {captureResponses: [royalMailApi]});
  await assert.rejects(capture.prepare(1000), /input was reset/);
  assert.equal(submitted, false);
});


test('Royal Mail ignores preflight and captures the carrier error body without flattening it to not-found', async () => {
  const {capture, respond} = await fixture(royalMailUrl, royalMailApi);
  await respond('', {method: 'OPTIONS', status: 401});
  const body = JSON.stringify({httpCode: 404, errors: [{errorCode: 'E1142'}]});
  await respond(body, {status: 404});
  await capture.settle(100);
  assert.equal(capture.hasResponse(), true);
  const rows = (await capture.drain()).capturedResponses;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, body);
});

test('Royal Mail opts out before navigation without adding identity cookies or altering other sites', async () => {
  const cookies = [];
  const page = {on() {}, context: () => ({addCookies: async values => cookies.push(...values)})};
  await attachTrackingCapture(page, upsUrl, {captureResponses: [upsApi]});
  assert.equal(cookies.length, 0);
  await attachTrackingCapture(page, royalMailUrl, {captureResponses: [royalMailApi]});
  assert.deepEqual(cookies.map(cookie => cookie.name).sort(), [
    'cmapi_cookie_privacy', 'cmapi_gtm_bl', 'notice_gdpr_prefs', 'notice_preferences',
  ]);
  assert.equal(cookies.find(cookie => cookie.name === 'cmapi_cookie_privacy').value, 'permit 1 required');
  assert.ok(cookies.every(cookie => cookie.domain === '.royalmail.com'
    && cookie.secure && cookie.sameSite === 'Lax' && cookie.expires === undefined));
});

test('Royal Mail reports connection failure promptly and skips form resubmission after verification', {timeout: 1000}, async () => {
  const {capture, handlers, detached} = await fixture(royalMailUrl, royalMailApi);
  const request = {url: () => royalMailApi, method: () => 'GET', failure: () => ({errorText: 'NS_ERROR_NET_RESET'})};
  handlers.request(request);
  handlers.requestfailed(request);
  assert.equal(capture.hasTrackingRequest(), true);
  assert.equal(capture.hasResponse(), false);
  // The fixture has no form methods: this must not try to submit again.
  await capture.prepare(5000);
  await capture.settle(5000);
  await assert.rejects(capture.drain(), {message: 'Royal Mail tracking request failed: NS_ERROR_NET_RESET'});
  assert.equal(detached(), true);
});

test('Royal Mail ignores unrelated failures and never includes arbitrary network error text', async () => {
  const {capture, handlers} = await fixture(royalMailUrl, royalMailApi);
  const request = (url, method = 'GET') => ({url: () => url, method: () => method,
    failure: () => ({errorText: 'PRIVATE_COOKIE https://example.test/?token=PRIVATE_TOKEN'})});
  for (const item of [request(royalMailApi, 'OPTIONS'), request(royalMailApiPrefix + 'SG999999998GB')]) {
    handlers.request(item); handlers.requestfailed(item);
  }
  assert.equal(capture.hasTrackingRequest(), false);
  handlers.request(request(royalMailApi)); handlers.requestfailed(request(royalMailApi));
  await assert.rejects(capture.drain(), {message: 'Royal Mail tracking request failed: network failure'});
});

test('Royal Mail retains an automatic tracking reply without starting another lookup', async () => {
  const {capture, handlers, respond} = await fixture(royalMailUrl, royalMailApi);
  handlers.request({url: () => royalMailApi, method: () => 'GET'});
  await respond(royalMailReply());
  await capture.prepare(1000);
  assert.equal(capture.hasTrackingRequest(), true);
  assert.equal((await capture.drain()).capturedResponses.length, 1);
});

for (const codeField of ['errorCode', 'code']) test(`Royal Mail waits for session refresh with ${codeField}`, {timeout: 1000}, async () => {
  const {capture, handlers, respond} = await fixture(royalMailUrl, royalMailApi);
  handlers.request({url: () => royalMailApi, method: () => 'GET'});
  const denied = JSON.stringify({errors: [{[codeField]: 'E0015'}]});
  await respond(denied, {status: 401});
  let settled = false;
  const waiting = capture.settle(500).then(() => {settled = true;});
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(settled, false);
  // The page is already refreshing its challenge; no second solver is needed.
  assert.equal(capture.hasTrackingRequest(), true);
  assert.equal(capture.hasResponse(), true);
  await respond(royalMailReply());
  await waiting;
  assert.deepEqual((await capture.drain()).capturedResponses.map(row => row.status), [401, 200]);
});

test('Royal Mail preserves a rejected session when automatic recovery never arrives', {timeout: 1000}, async () => {
  const {capture, respond} = await fixture(royalMailUrl, royalMailApi);
  const denied = JSON.stringify({errors: [{errorCode: 'E0015'}]});
  await respond(denied, {status: 401});
  await capture.settle(10);
  assert.equal((await capture.drain()).capturedResponses[0].body, denied);
});

test('Royal Mail ends repeated challenge failures and other final errors promptly', {timeout: 1000}, async () => {
  const denied = JSON.stringify({errors: [{errorCode: 'E0015'}]});
  for (const [status, body, firstDenied] of [
    [401, denied, true],
    [401, JSON.stringify({errors: [{errorCode: 'E9999'}]}), false],
    [403, denied, false],
    [429, JSON.stringify({httpCode: '429'}), false],
  ]) {
    const {capture, respond} = await fixture(royalMailUrl, royalMailApi);
    if (firstDenied) await respond(denied, {status: 401});
    await respond(body, {status});
    await capture.settle(5000);
    const rows = (await capture.drain()).capturedResponses;
    assert.equal(rows.at(-1).body, body);
  }
});
