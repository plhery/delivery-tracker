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
];

export async function attachTrackingCapture(page, url, options) {
  const target = new URL(url);
  const site = SITES.find(candidate => options.captureResponses?.includes(candidate.api) && candidate.number(target));
  if (!site) return undefined;
  const api = site.api;
  const number = site.number(target);
  const entries = [];
  let accepting = true;
  let count = 0;
  let bytes = 0;
  let finish;
  const ready = new Promise(resolve => { finish = resolve; });
  const onResponse = async response => {
    if (!accepting || response.url() !== api || ++count > 20) return;
    const headers = response.headers();
    const entry = { url: api, status: response.status(), body: null,
      headers: headers['retry-after'] ? { 'retry-after': headers['retry-after'].slice(0, 100) } : {},
      truncated: false, base64Encoded: false };
    entries.push(entry);
    if (entry.status !== 200) { finish(); return; }
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
      return { capturedResponses: entries.map(entry => ({ ...entry })) };
    },
  };
}
