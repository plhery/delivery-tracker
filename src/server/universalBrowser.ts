import 'server-only';

import { chromium, type Browser, type Page, type Response } from 'playwright-core';
import type { CarrierResult } from './carrierResult';

export interface UniversalBrowserOptions {
  executablePath?: string;
  timeoutMs?: number;
}

// A process handles many syncs concurrently. Do not spawn a browser per parcel
// when a carrier outage sends an entire batch through the fallback chain.
let busy = false;

export async function scrapeUniversalPage(
  options: UniversalBrowserOptions,
  spec: { name: string; url: string; responseUrl: string; submit?: (page: Page) => Promise<void> },
  parse: (payload: unknown) => CarrierResult,
): Promise<CarrierResult> {
  const executablePath = options.executablePath ?? process.env.TRACKING_CHROMIUM_PATH;
  if (!executablePath) throw new Error(`${spec.name} requires TRACKING_CHROMIUM_PATH`);
  const timeoutMs = options.timeoutMs ?? 45_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new TypeError('Browser tracking timeout must be between 1 and 60000 ms');
  if (busy) throw new Error('Tracking browser is busy; retry on the next sync');
  busy = true;
  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    const deadline = Date.now() + timeoutMs;
    // Do not pass the application environment (database/API secrets) to Chromium.
    browser = await chromium.launch({ executablePath, headless: true,
      args: ['--disable-blink-features=AutomationControlled'], timeout: Math.min(timeoutMs, 10_000),
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '/tmp', LANG: 'en_US.UTF-8' } });
    const platform = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';
    const userAgent = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
    const remaining = Math.max(1, deadline - Date.now());
    let received = 0;
    let resolveHistory!: (result: CarrierResult) => void;
    let rejectHistory!: (error: Error) => void;
    const history = new Promise<CarrierResult>((resolve, reject) => {
      resolveHistory = resolve; rejectHistory = reject;
      timer = setTimeout(() => { expired = true; reject(new Error(`${spec.name} did not return matching tracking history before the timeout`)); }, remaining);
    });
    // Attach the rejection handler before navigation can fail or time out.
    const navigation = (async () => {
      const context = await browser!.newContext({ userAgent, locale: 'en-US', timezoneId: 'UTC', acceptDownloads: false, serviceWorkers: 'block' });
      // Only the provider and its challenge resources are needed. This also keeps
      // advertisements and provider scripts from reaching private network hosts.
      const provider = new URL(spec.url).hostname.replace(/^www\./, '');
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        const allowed = url.protocol === 'https:' && (url.hostname === provider || url.hostname.endsWith(`.${provider}`)
          || url.hostname.endsWith('.challenges.cloudflare.com')
          || ['challenges.cloudflare.com', 'www.google.com', 'www.gstatic.com', 'www.recaptcha.net'].includes(url.hostname));
        await (allowed ? route.continue() : route.abort());
      });
      const page = await context.newPage();
      page.setDefaultTimeout(remaining);
      page.on('response', async (response: Response) => {
        if (expired || response.url() !== spec.responseUrl || ![200, 201].includes(response.status())) return;
        if (++received > 20) { rejectHistory(new Error(`${spec.name} returned too many polling responses`)); return; }
        try {
          if (Number(response.headers()['content-length'] ?? 0) > 2_000_000) return;
          const body = await response.body();
          if (expired || body.length > 2_000_000) return;
          resolveHistory(parse(JSON.parse(body.toString('utf8'))));
        } catch {
          // Initial polling, challenges and unrelated shipments are not history.
        }
      });

      const response = await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: remaining });
      // Cloudflare initially responds with 403, then navigates after its
      // automatic browser check. Let the bounded lookup wait for that reload.
      const challenge = response?.status() === 403 && response.headers()['cf-mitigated'] === 'challenge';
      if (!response || (response.status() !== 200 && !challenge)) throw new Error(`${spec.name} tracking page is unavailable (HTTP ${response?.status() ?? 0})`);
      if (spec.submit) await spec.submit(page);
      return history;
    })();
    return await Promise.race([navigation, history]);
  } finally {
    expired = true;
    if (timer) clearTimeout(timer);
    try { await browser?.close(); } finally { busy = false; }
  }
}
