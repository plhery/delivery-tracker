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
    // The hash route supplies the number, but a cold page must submit its
    // form before hCaptcha can trigger the per-number summary request.
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
  const entries = [];
  let accepting = true;
  let count = 0;
  let bytes = 0;
  let finish;
  const ready = new Promise(resolve => { finish = resolve; });
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
  return {
    // Called by both TRAWL browser tiers after navigation and before solving.
    ...(site.perNumber ? { async prepare(budgetMs) {
      const deadline = Date.now() + Math.max(0, Math.min(budgetMs, 15_000));
      const timeout = () => {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('Royal Mail form preparation timed out');
        return left;
      };
      const input = page.locator('#barcode-input');
      await input.waitFor({ state: 'visible', timeout: timeout() });
      // TrustArc can arrive after the app mounts. Dismiss optional cookies
      // before clicking, and handle a banner that appears during that click.
      const decline = page.getByText('Decline all', { exact: true });
      await decline.waitFor({ state: 'visible', timeout: Math.min(timeout(), 3_000) }).catch(() => {});
      if (await decline.isVisible()) await decline.evaluate(element => element.click());
      // Native key events update React's controlled state even after the
      // hash route prefilled it. A DOM-only fill can leave stale form state.
      await input.press('ControlOrMeta+A', { timeout: timeout() });
      await input.press('Backspace', { timeout: timeout() });
      await input.pressSequentially(number, { timeout: timeout(), delay: 30 });
      if (await input.inputValue() !== number) throw new Error('Royal Mail input was reset before submission');
      try { await page.locator('#submit').click({ timeout: Math.min(timeout(), 2_000) }); }
      catch (error) {
        if (!await decline.isVisible()) throw error;
        await decline.evaluate(element => element.click());
        await page.locator('#submit').click({ timeout: timeout() });
      }
      // Invisible hCaptcha commonly auto-passes after submit. Its callback
      // sends the API request and resets the widget; do not click it again.
      let timer;
      try { await Promise.race([ready, new Promise(resolve => {
        timer = setTimeout(resolve, Math.min(timeout(), 5_000));
      })]); } finally { clearTimeout(timer); }
    } } : {}),
    hasResponse() { return Boolean(site.perNumber && entries.some(entry => entry.body !== null || entry.status !== 200)); },
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
      // A loaded app shell is not a successful Royal Mail session. Let the
      // orchestrator invalidate cached cookies and try its fresh browser tier.
      if (site.perNumber && entries.length === 0) {
        throw new Error('Royal Mail produced no tracking response after form submission');
      }
      return { capturedResponses: entries.map(entry => ({ ...entry })) };
    },
  };
}
