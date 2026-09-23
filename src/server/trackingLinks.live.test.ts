import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { parcelTrackingLinks } from '../lib/carriers';
import { trackingLinkCases } from './trackingLinkCases';
import { trackingPageVerdict } from './trackingLinkProbe';

describe('UI tracking links (rendered public pages)', () => {
  let browser: Browser;
  let userAgent: string;
  beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: process.env.TRACKING_CHROMIUM_PATH || chromium.executablePath(),
      headless: true,
    });
    // Users open these links in a regular browser. DHL resets HTTP/2 streams
    // for the default HeadlessChrome agent, so present the same desktop Chrome
    // agent as the universal browser transport.
    const platform = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';
    userAgent = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
  });
  afterAll(async () => { await browser?.close(); });

  it.for(trackingLinkCases.map((testCase) => ({ ...testCase, name: testCase.carrier + (testCase.provider ? '/' + testCase.provider : '') })))('$name opens a tracking page', { timeout: 45_000 }, async (testCase, context) => {
    const [link] = parcelTrackingLinks({
      carrier: testCase.carrier, trackingNumber: testCase.number,
      trackingProvider: testCase.provider,
    }, 'en');
    expect(link).toBeDefined();
    const page = await browser.newPage({ locale: 'en-US', userAgent });
    let lookupObserved = false;
    let documentStatus: number | undefined;
    page.on('response', (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        documentStatus = response.status();
      }
    });
    page.on('request', (request) => {
      if (!['fetch', 'xhr'].includes(request.resourceType())) return;
      // Analytics beacons echo the page address, which contains the number.
      // Only a request carrying it elsewhere shows the page looking it up.
      let sent = `${request.url()}\n${request.postData() ?? ''}`;
      try { sent = decodeURIComponent(sent); } catch { /* keep the raw request */ }
      for (const address of [link.url, page.url()]) {
        const { pathname, search, hash } = new URL(address);
        for (const echo of [address, pathname + search + hash, pathname + search]) sent = sent.split(echo).join('');
      }
      if (sent.includes(testCase.number)) lookupObserved = true;
    });
    try {
      let response;
      try {
        response = await page.goto(link.url, { waitUntil: 'commit', timeout: 20_000 });
      } catch (error) {
        // A headless transport failure is inconclusive. Only permit a skip after
        // an independent HTTP GET rules out a missing page or broken redirect.
        const http = await fetch(link.url, { signal: AbortSignal.timeout(10_000) });
        const html = await http.text();
        const verdict = trackingPageVerdict({ status: http.status, url: http.url,
          title: '', text: html.replace(/<[^>]*>/g, ' ') }, testCase.route, testCase.marker);
        if (verdict !== 'broken' && testCase.route.test(http.url) && process.env.TRACKING_LINKS_STRICT !== '1') {
          console.warn(testCase.carrier + ': HTTP endpoint reachable; browser transport unverified');
          context.skip('HTTP endpoint reachable; browser transport failed, rendered link remains unverified');
        }
        throw error;
      }
      expect(response, 'Navigation must return an HTTP response').not.toBeNull();
      let verdict: ReturnType<typeof trackingPageVerdict> = 'unverified';
      let inputBound = false;
      // Allow hydration and client redirects before inspecting the final page.
      for (let attempt = 0; attempt < 10; attempt++) {
        await page.waitForTimeout(1000);
        // A body still being replaced is read again on the next pass.
        const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
        const { forwarding } = testCase;
        inputBound = forwarding === 'none' || lookupObserved || text.includes(testCase.number)
          || (typeof forwarding === 'object' && forwarding.notFound.test(text))
          || await page.locator('input, textarea').evaluateAll(
            (elements, number) => elements.some((element) => (element as HTMLInputElement).value === number),
            testCase.number,
          );
        verdict = trackingPageVerdict({
          status: documentStatus ?? response!.status(), url: page.url(), title: await page.title(),
          text,
        }, testCase.route, testCase.marker);
        if (verdict === 'broken' || (attempt >= 2 && verdict === 'tracking-page' && inputBound)) break;
      }
      // Skipped is deliberately not a pass: bot protection cannot prove the
      // deep link works. Strict mode turns those gaps into failures in CI.
      if (verdict === 'blocked' && process.env.TRACKING_LINKS_STRICT !== '1') {
        console.warn(testCase.carrier + ': carrier bot protection; tracking link unverified');
        context.skip('Carrier bot protection: tracking link remains unverified');
      }
      // Address and title only: page text can hold other people's shipments.
      const landed = `landed on ${page.url()} titled ${JSON.stringify(await page.title())}`;
      expect(verdict, `Expected a rendered tracker on its known route, not a homepage/error/challenge; ${landed}`).toBe('tracking-page');
      expect(inputBound, `The deep link must prefill, display or submit the synthetic tracking number; ${landed}`).toBe(true);
    } finally {
      await page.close();
    }
  });
});
