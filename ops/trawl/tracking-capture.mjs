// TRAWL 1.5.0 skips compressed bodies and settles on the first polling reply.
// This compatibility adapter observes the browser's own reply for a few exact
// tracking endpoints, each on its public page with one valid number. Every
// other capture request keeps TRAWL's stock behaviour.
const SITES = [
  {
    // 17TRACK polls: keep reading until a completed reply names the number.
    api: 'https://t.17track.net/track/restapi',
    number(page) {
      if (page.origin !== 'https://t.17track.net' || page.pathname !== '/en') return null;
      const number = new URLSearchParams(page.hash.slice(1)).get('nums');
      return number && /^[A-Z0-9]{5,40}$/.test(number) ? number : null;
    },
    settled(data, number) {
      return data.meta?.code !== 200 || data.shipments?.some(s => s.number === number && s.code !== 100);
    },
  },
  {
    // UPS answers once. Akamai accepts this call only from the session the
    // page established, which is why the reply is read here and never replayed.
    api: 'https://webapis.ups.com/track/api/Track/GetStatus?loc=en_US',
    number(page) {
      if (page.origin !== 'https://www.ups.com' || page.pathname !== '/track') return null;
      const number = (page.searchParams.get('tracknum') ?? '').toUpperCase();
      return /^1Z[A-Z0-9]{16}$/.test(number) ? number : null;
    },
    settled(data, number) {
      const details = Array.isArray(data.trackDetails) ? data.trackDetails : [];
      return String(data.statusCode) !== '200' || details.length === 0
        || details.some(d => String(d?.trackingNumber ?? d?.requestedTrackingNumber ?? '').toUpperCase() === number);
    },
  },
  {
    // FedEx answers once. The edge accepts this call only from the session
    // the page established, which is why the reply is read here and never
    // replayed. The page redirects its canonical /fedextrack/ URL to the
    // /wtrk/track/ application, so both pathnames serve the same lookup.
    api: 'https://api.fedex.com/track/v2/shipments',
    number(page) {
      if (page.origin !== 'https://www.fedex.com') return null;
      if (page.pathname !== '/wtrk/track/' && page.pathname !== '/fedextrack/') return null;
      const number = (page.searchParams.get('trknbr') ?? '').toUpperCase();
      return /^(\d{12}|\d{15})$/.test(number) ? number : null;
    },
    settled(data) {
      // One POST, one final reply: any decoded envelope ends the wait. The
      // adapter binds the packages to the requested number itself.
      return !!data?.output;
    },
  },
  {
    // The hash route can start tracking with consent already recorded;
    // otherwise submit the form after any consent-triggered reload.
    api: 'https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/',
    perNumber: true,
    number(page) {
      if (page.origin !== 'https://www.royalmail.com' || page.pathname !== '/track-your-item') return null;
      const number = (/^#\/tracking-results\/([A-Z0-9]+)\/?$/.exec(page.hash)?.[1] ?? '');
      return /^[A-Z]{2}\d{9}GB$/.test(number) ? number : null;
    },
    settled(data) {
      // One GET, one final reply: any decoded envelope ends the wait. The
      // adapter binds the mailpiece to the requested number itself.
      return !!data && typeof data === 'object';
    },
  },
];

// Royal Mail's TrustArc "Decline all" preferences. These contain no consent
// identifier, browser identity or session token. Keep them as session cookies.
const ROYAL_MAIL_OPT_OUT = {
  notice_preferences: '0:',
  notice_gdpr_prefs: '0::implied,eu',
  cmapi_cookie_privacy: 'permit 1 required',
  cmapi_gtm_bl: 'ga-ms-ua-ta-asp-bzi-sp-awct-cts-csm-img-flc-fls-mpm-mpr-m6d-tc-tdc',
};
const NETWORK_ERRORS = new Set([
  'NS_ERROR_NET_RESET', 'NS_ERROR_NET_TIMEOUT', 'NS_ERROR_UNKNOWN_HOST',
  'net::ERR_CONNECTION_RESET', 'net::ERR_HTTP2_PROTOCOL_ERROR', 'net::ERR_TIMED_OUT',
]);

export async function attachTrackingCapture(page, url, options) {
  const target = new URL(url);
  const requested = options.captureResponses ?? [];
  const site = SITES.find(candidate => candidate.number(target)
    && (candidate.perNumber
      ? requested.includes(candidate.api + candidate.number(target))
      : requested.includes(candidate.api)));
  if (!site) return undefined;
  const number = site.number(target);
  const api = site.api + (site.perNumber ? number : '');
  if (site.perNumber) {
    await page.context().addCookies(Object.entries(ROYAL_MAIL_OPT_OUT).map(([name, value]) => ({
      name, value, domain: '.royalmail.com', path: '/', secure: true, sameSite: 'Lax',
    })));
  }
  const entries = [];
  let trackingRequested = false;
  let networkError;
  let accepting = true;
  let count = 0;
  let bytes = 0;
  let finish;
  const ready = new Promise(resolve => { finish = resolve; });
  const matchesRequest = request => accepting && request.url() === api && request.method() === 'GET';
  const onRequest = request => { if (matchesRequest(request)) trackingRequested = true; };
  const onRequestFailed = request => {
    if (!matchesRequest(request)) return;
    const code = request.failure()?.errorText;
    networkError = NETWORK_ERRORS.has(code) ? code : 'network failure';
    finish();
  };
  const onResponse = async response => {
    if (!accepting || response.url() !== api
      || (site.perNumber && response.request().method() !== 'GET') || ++count > 20) return;
    const headers = response.headers();
    const entry = { url: api, status: response.status(), body: null,
      headers: headers['retry-after'] ? { 'retry-after': headers['retry-after'].slice(0, 100) } : {},
      truncated: false, base64Encoded: false };
    entries.push(entry);
    if (entry.status !== 200 && !site.perNumber) { finish(); return; }
    const type = headers['content-type'] ?? '';
    const length = headers['content-length'] === undefined ? 0 : Number(headers['content-length']);
    // The browser already decoded this response for the site. Do not implement
    // our own decompressor, fetch again or transfer the session to Node.
    if (!type.includes('application/json') || !Number.isSafeInteger(length)
      || length < 0 || length > 2_000_000 || bytes >= 4_000_000) {
      entry.error = 'unsupported or oversized tracking response'; finish(); return;
    }
    try {
      const body = await response.body();
      if (!accepting) return;
      bytes += body.length;
      if (body.length > 2_000_000 || bytes > 4_000_000) {
        entry.truncated = true; entry.error = 'tracking response budget exceeded'; finish(); return;
      }
      entry.body = body.toString('utf8');
      const data = JSON.parse(entry.body);
      // Preserve intermediate replies for diagnosis, but let the website carry
      // on until it holds a final reply for exactly the requested number.
      if (site.settled(data, number)) finish();
    } catch { entry.error = 'tracking response could not be read'; }
  };
  page.on('response', onResponse);
  if (site.perNumber) {
    page.on('request', onRequest);
    page.on('requestfailed', onRequestFailed);
  }
  return {
    // Called by both TRAWL browser tiers after navigation and before solving.
    ...(site.perNumber ? { async prepare(budgetMs) {
      const deadline = Date.now() + Math.max(0, Math.min(budgetMs, 15_000));
      const timeout = () => {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('Royal Mail form preparation timed out');
        return left;
      };
      const awaitReply = async () => {
        let timer;
        try { await Promise.race([ready, new Promise(resolve => {
          timer = setTimeout(resolve, Math.min(timeout(), 5_000));
        })]); } finally { clearTimeout(timer); }
      };
      // With opt-out preferences already present, the hash route can start
      // the lookup itself. Avoid submitting a second challenge/request.
      if (trackingRequested) { await awaitReply(); return; }
      const input = page.locator('#barcode-input');
      await input.waitFor({ state: 'visible', timeout: timeout() });
      // TrustArc can arrive after the app mounts. Dismiss optional cookies
      // before clicking, and handle a banner that appears during that click.
      const decline = page.getByText('Decline all', { exact: true });
      await decline.waitFor({ state: 'visible', timeout: Math.min(timeout(), 3_000) }).catch(() => {});
      if (await decline.isVisible()) {
        // TrustArc can reload the document after consent changes. Typing
        // before that reload finishes fills the outgoing form, while submit
        // resolves against a new, empty form and never triggers hCaptcha.
        const reloaded = page.waitForEvent('domcontentloaded', {
          timeout: Math.min(timeout(), 3_000),
        }).catch(() => {});
        await decline.evaluate(element => element.click());
        await reloaded;
        await input.waitFor({ state: 'visible', timeout: timeout() });
      }
      if (trackingRequested) { await awaitReply(); return; }
      // Native key events update React's controlled state even after the
      // hash route prefilled it. A DOM-only fill can leave stale form state.
      await input.press('ControlOrMeta+A', { timeout: timeout() });
      await input.press('Backspace', { timeout: timeout() });
      await input.pressSequentially(number, { timeout: timeout(), delay: 30 });
      if (await input.inputValue() !== number) throw new Error('Royal Mail input was reset before submission');
      // Camoufox's humanized mouse action can stall after reaching the button.
      // Invoke the page's normal click handler; it still runs its validation
      // and hCaptcha callback before making any tracking request.
      const submit = page.locator('#submit:not(:disabled)');
      await submit.waitFor({ state: 'visible', timeout: timeout() });
      if (trackingRequested) { await awaitReply(); return; }
      const submitted = await submit.evaluate((element, expected) => {
        // Check and click in one document: a late reload must not turn a
        // locally validated number into an empty submission.
        if (element.ownerDocument.querySelector('#barcode-input')?.value !== expected) return false;
        element.click();
        return true;
      }, number);
      if (!submitted) throw new Error('Royal Mail input was reset before submission');
      // Invisible hCaptcha commonly auto-passes after submit. Its callback
      // sends the API request and resets the widget; do not click it again.
      await awaitReply();
    } } : {}),
    hasResponse() { return Boolean(site.perNumber && entries.some(entry => entry.body !== null || entry.status !== 200)); },
    // Royal Mail sends this GET only after its hCaptcha success callback.
    // A later connection failure cannot be repaired by clicking a checkbox.
    hasTrackingRequest() { return Boolean(site.perNumber && trackingRequested); },
    async settle(budgetMs) {
      let timer;
      try {
        await Promise.race([ready, new Promise(resolve => {
          timer = setTimeout(resolve, Math.max(0, Math.min(budgetMs, options.settleTimeout ?? 15_000, 30_000)));
        })]);
      } finally { clearTimeout(timer); }
    },
    async drain() {
      accepting = false;
      page.off('response', onResponse);
      if (site.perNumber) {
        page.off('request', onRequest);
        page.off('requestfailed', onRequestFailed);
      }
      // A loaded app shell is not a successful Royal Mail session. Let the
      // orchestrator invalidate cached cookies and try its fresh browser tier.
      if (site.perNumber && entries.length === 0) {
        if (networkError) throw new Error(`Royal Mail tracking request failed: ${networkError}`);
        throw new Error('Royal Mail produced no tracking response after form submission');
      }
      return { capturedResponses: entries.map(entry => ({ ...entry })) };
    },
  };
}
