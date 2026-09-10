// TRAWL 1.5.0 skips compressed bodies and settles on the first polling reply.
// Restrict this compatibility adapter to the observed 17TRACK JSON endpoint.
export async function attachTrackingCapture(page, url, options) {
  const api = 'https://t.17track.net/track/restapi';
  const target = new URL(url);
  if (target.origin !== 'https://t.17track.net' || target.pathname !== '/en'
    || !options.captureResponses?.includes(api)) return undefined;
  const number = new URLSearchParams(target.hash.slice(1)).get('nums');
  if (!number || !/^[A-Z0-9]{5,40}$/.test(number)) return undefined;
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
      // Preserve intermediate replies for diagnosis, but let the website poll
      // until it returns a completed result for exactly the requested number.
      if (data.meta?.code !== 200 || data.shipments?.some(s => s.number === number && s.code !== 100)) finish();
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
