// Keep a verified FedEx browser context on its original pooled browser. Moving
// its cookies to another context/browser did not preserve API acceptance.
const PAGE = 'https://www.fedex.com/fedextrack/';
const API = 'https://api.fedex.com/track/v2/shipments';
const MAX_BODY = 2_000_000;

export function fedexSessionNumber(url, capture = {}) {
  let page;
  try { page = new URL(url); } catch { return null; }
  if (page.origin !== 'https://www.fedex.com'
    || !['/fedextrack/', '/wtrk/track/'].includes(page.pathname)
    || capture.captureResponses?.length !== 1 || capture.captureResponses[0] !== API) return null;
  const numbers = page.searchParams.getAll('trknbr');
  return numbers.length === 1 && /^(\d{12}|\d{15})$/.test(numbers[0]) ? numbers[0] : null;
}

async function bounded(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), Math.max(0, ms));
    })]);
  } finally { clearTimeout(timer); }
}

export class FedExSessions {
  #sessions = new WeakMap();
  #attempted = new WeakMap();
  constructor({ idleMs = 30 * 60_000, maxAgeMs = 2 * 60 * 60_000, closeMs = 3_000 } = {}) {
    this.idleMs = idleMs;
    this.maxAgeMs = maxAgeMs;
    this.closeMs = closeMs;
  }

  preferred(entries, domain) {
    if (domain !== 'www.fedex.com' || !entries.length) return undefined;
    const ready = entries.find(entry => {
      const session = this.#sessions.get(entry.browser);
      return session?.verified && !session.disposed && !session.page.isClosed()
        && Date.now() - session.created < this.maxAgeMs;
    });
    if (ready) return ready;
    // The pool otherwise sticks to the first browser that visited a domain,
    // including rejected attempts. A later lookup may try another available
    // browser; there is no extra request or retry inside this lookup.
    return entries.reduce((best, entry) => (this.#attempted.get(entry.browser) ?? 0)
      < (this.#attempted.get(best.browser) ?? 0) ? entry : best);
  }

  async #discard(browser, session, replace) {
    if (session.disposed) return;
    session.disposed = true;
    clearTimeout(session.timer);
    browser.off('disconnected', session.disconnected);
    if (this.#sessions.get(browser) === session) this.#sessions.delete(browser);
    if (!session.context) {
      if (browser.isConnected?.() !== false) replace?.('FedEx session setup did not finish');
      return;
    }
    try { await bounded(session.context.close(), this.closeMs, 'FedEx session cleanup timed out'); }
    catch { replace?.('FedEx session cleanup failed'); }
  }

  #retain(browser, session, replace) {
    const left = Math.min(this.idleMs, this.maxAgeMs - (Date.now() - session.created));
    session.timer = setTimeout(() => { void this.#discard(browser, session, replace); }, Math.max(0, left));
    session.timer.unref?.();
  }

  async run({ url, handle, tier, maxTimeout, capture, installPolicy }) {
    const number = fedexSessionNumber(url, capture);
    if (!number) return undefined;
    const started = Date.now(), browser = handle.browser;
    const failure = reason => ({ tier, status: 'error', reason, durationMs: Date.now() - started });
    if (!Number.isFinite(maxTimeout) || maxTimeout < 1) return failure('FedEx lookup budget exhausted');
    let session = this.#sessions.get(browser);
    // The pool serializes leases; this also protects against accidental direct
    // callers sharing a browser while one lookup is still in flight.
    if (session?.busy) return failure('FedEx browser session is busy');
    this.#attempted.set(browser, Date.now());
    if (session && (Date.now() - session.created >= this.maxAgeMs || session.page.isClosed())) {
      await this.#discard(browser, session, handle.requestBrowserReplacement);
      session = undefined;
    }
    const reused = Boolean(session?.verified);
    if (!session) {
      session = { created: Date.now(), busy: true, verified: false, disposed: false };
      session.disconnected = () => { void this.#discard(browser, session, handle.requestBrowserReplacement); };
      this.#sessions.set(browser, session);
      browser.once('disconnected', session.disconnected);
    }
    clearTimeout(session.timer);
    session.busy = true;
    try {
      const result = await bounded(this.#lookup({ number, session, browser, started, maxTimeout, installPolicy,
        replace: handle.requestBrowserReplacement, onCreated: handle.noteTemporaryContext }),
        Math.max(0, maxTimeout - (Date.now() - started)), 'FedEx lookup budget exhausted');
      if (!session.verified) await this.#discard(browser, session, handle.requestBrowserReplacement);
      return { tier, status: 'success', statusCode: 200, durationMs: Date.now() - started,
        effectiveUrl: url, ...result, cookies: [], reason: reused ? 'fedex-session-reused' : 'fedex-session-new' };
    } catch {
      // Selector and navigation errors can include the number; do not include
      // those raw messages in shared browser-service diagnostics.
      await this.#discard(browser, session, handle.requestBrowserReplacement);
      return failure('FedEx browser session could not complete tracking');
    } finally {
      session.busy = false;
      if (session.verified && !session.disposed) this.#retain(browser, session, handle.requestBrowserReplacement);
    }
  }

  async #lookup({ number, session, browser, started, maxTimeout, installPolicy, replace, onCreated }) {
    const timeout = (cap = 15_000) => {
      const remaining = maxTimeout - (Date.now() - started);
      if (remaining <= 0 || session.disposed) throw new Error('FedEx lookup budget exhausted');
      return Math.min(cap, remaining);
    };
    if (!session.context) {
      const context = await browser.newContext();
      if (session.disposed) {
        void bounded(context.close(), this.closeMs, 'FedEx late context cleanup timed out')
          .catch(() => { replace?.('FedEx late session cleanup failed'); });
        throw new Error('FedEx lookup ended during browser setup');
      }
      session.context = context;
      onCreated?.();
      session.page = await context.newPage();
      await installPolicy?.(session.page);
    }
    const page = session.page;
    // Begin each lookup at the blank form while preserving the context. The
    // result-page form can ignore submissions or retain the previous route.
    session.verified = false;
    let submitted = false, resolveReply;
    const requests = new Set();
    const reply = new Promise(resolve => { resolveReply = resolve; });
    const matches = request => {
      if (!submitted || request.url() !== API || request.method() !== 'POST') return false;
      try {
        const info = request.postDataJSON()?.trackingInfo;
        return info?.length === 1 && info[0]?.trackNumberInfo?.trackingNumber === number;
      } catch { return false; }
    };
    const onResponse = response => { if (requests.has(response.request())) resolveReply(response); };
    const onFailure = request => { if (requests.has(request)) resolveReply(null); };
    const onRequest = request => { if (matches(request)) requests.add(request); };
    page.on('response', onResponse);
    page.on('requestfailed', onFailure);
    page.on('request', onRequest);
    try {
      await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: timeout(25_000) });
      const consent = page.getByRole('button', { name: 'REJECT OPTIONAL COOKIES', exact: true });
      try { await consent.click({ timeout: timeout(4_000) }); }
      catch { timeout(); }
      const another = page.getByRole('button', { name: 'Track Another Shipment', exact: true });
      const input = page.locator('input[id^="tracking_number_"]').first();
      try { await another.click({ timeout: timeout(5_000) }); }
      catch {
        timeout();
        // Camoufox mouse movement can stall. Only invoke the menu handler if
        // its form did not already open; a second toggle would close it.
        if (!await input.isVisible()) await another.evaluate(element => element.click(), undefined, { timeout: timeout() });
      }
      await input.fill(number, { timeout: timeout() });
      if (await input.inputValue({ timeout: timeout() }) !== number) throw new Error('FedEx input changed');
      submitted = true;
      const submit = page.getByRole('button', { name: /^track$/i, exact: true });
      try { await submit.click({ timeout: timeout(5_000) }); }
      catch {
        timeout();
        // A click can dispatch the request before its automation action times
        // out. Never submit twice when that request is already in flight.
        if (!requests.size) await submit.evaluate(element => { if (!element.disabled) element.click(); }, undefined, { timeout: timeout() });
      }
      const response = await bounded(reply, timeout(), 'FedEx tracking response missing');
      if (!response) throw new Error('FedEx tracking connection failed');
      const headers = response.headers();
      const retainedHeaders = {};
      for (const name of ['content-type', 'server', 'retry-after']) {
        if (headers[name]) retainedHeaders[name] = headers[name].slice(0, 100);
      }
      const entry = { url: API, status: response.status(), body: null, truncated: false, base64Encoded: false,
        headers: retainedHeaders };
      if ([401, 403].includes(entry.status)) {
        entry.error = /akamai/i.test(retainedHeaders.server ?? '')
          && /text\/html/i.test(retainedHeaders['content-type'] ?? '')
          ? 'fedex-edge-denial' : 'fedex-browser-request-rejected';
      }
      if (entry.status === 200) {
        const length = Number(headers['content-length'] ?? 0);
        if (!String(headers['content-type'] ?? '').includes('application/json')
          || !Number.isSafeInteger(length) || length < 0 || length > MAX_BODY) {
          entry.error = 'unsupported or oversized tracking response';
        } else {
          const body = await bounded(response.body(), timeout(5_000), 'FedEx response read timed out');
          if (body.length > MAX_BODY) { entry.truncated = true; entry.error = 'tracking response budget exceeded'; }
          else {
            entry.body = body.toString('utf8');
            try {
              const packages = JSON.parse(entry.body)?.output?.packages;
              const matches = Array.isArray(packages) ? packages.filter(p => p?.trackingNbr === number) : [];
              session.verified = matches.length === 1 && Boolean(matches[0].keyStatus || matches[0].keyStatusCD
                || (Array.isArray(matches[0].scanEventList) && matches[0].scanEventList.length));
            } catch { entry.error = 'tracking response could not be read'; }
          }
        }
      }
      // Responses are never cached. Retaining this context retains only the
      // browser session; every lookup submits and captures its own request.
      const html = await bounded(page.content(), timeout(3_000), 'FedEx page read timed out');
      return { html, capturedResponses: [entry] };
    } finally {
      page.off('response', onResponse);
      page.off('requestfailed', onFailure);
      page.off('request', onRequest);
    }
  }
}

export const fedexSessions = new FedExSessions();
export const preferredFedExEntry = (entries, domain) => fedexSessions.preferred(entries, domain);
