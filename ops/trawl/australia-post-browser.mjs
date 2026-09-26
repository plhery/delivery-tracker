import { attachTrackingCapture } from './tracking-capture.mjs';

/** Only the carrier's public detail page and its exact anonymous query opt in. */
export function australiaPostBrowserRequest(rawUrl, capture = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.origin !== 'https://auspost.com.au' || url.search || url.hash) return false;
  const number = /^\/mypost\/track\/details\/((?=[A-Z0-9]*\d)[A-Z0-9]{10,34})\/?$/.exec(url.pathname)?.[1];
  const api = `https://digitalapi.auspost.com.au/shipments-gateway/v1/watchlist/shipments?trackingIds=${number}`;
  return Boolean(number && capture.captureResponses?.length === 1 && capture.captureResponses[0] === api);
}

/** A fresh carrier-locale context on the existing leased browser, with no retained state. */
export async function runAustraliaPostBrowser({ url, handle, tier, maxTimeout, capture, installPolicy,
  locale = process.env.AUSTRALIA_POST_BROWSER_LOCALE || 'de-DE' }) {
  const start = Date.now();
  let context;
  let pageCapture;
  let timer;
  let expired = false;
  const remaining = () => Math.max(1, maxTimeout - (Date.now() - start));
  const close = async target => {
    let finished = false;
    let cleanupTimer;
    try {
      await Promise.race([
        Promise.resolve().then(() => target.close()).then(() => { finished = true; }).catch(() => {}),
        new Promise(resolve => { cleanupTimer = setTimeout(resolve, 1500); }),
      ]);
    } finally {
      clearTimeout(cleanupTimer);
      if (!finished) handle.requestBrowserReplacement?.('Australia Post context cleanup timed out');
    }
  };
  try {
    return await Promise.race([
      (async () => {
        // Match the verified network locale without changing the shared pool.
        // Carrier event offsets and the API's status vocabulary are independent.
        const created = await handle.browser.newContext({ viewport: null, locale });
        handle.noteTemporaryContext?.();
        if (expired) { await close(created); throw new Error('Australia Post context arrived after its deadline'); }
        context = created;
        const page = await context.newPage();
        await installPolicy(page);
        pageCapture = await attachTrackingCapture(page, url, capture);
        const navigation = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: remaining() });
        await pageCapture.prepare(remaining());
        await pageCapture.settle(remaining());
        const evidence = await pageCapture.drain();
        const html = await page.content();
        return { tier, status: 'success', durationMs: Date.now() - start,
          html, statusCode: navigation?.status() ?? 0, effectiveUrl: page.url(),
          cookies: [], userAgent: await page.evaluate(() => navigator.userAgent), ...evidence };
      })(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error('Australia Post browser budget exhausted')); }, maxTimeout);
      }),
    ]);
  } catch {
    return { tier, status: 'error', durationMs: Date.now() - start,
      reason: expired ? 'Australia Post browser budget exhausted' : 'Australia Post browser retrieval failed' };
  } finally {
    clearTimeout(timer);
    expired = true;
    await pageCapture?.drain().catch(() => {});
    if (context) await close(context);
  }
}
