import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { parcelTrackingLinks } from '../lib/carriers';
import type { CarrierId } from '../types';
import { trackingPageVerdict } from './trackingLinkProbe';

// Used carriers plus historical handoffs and the actual fallback link in the UI.
// All numbers are synthetic; no production identifiers or capability URLs.
// Expected routes/markers are independent of the generated link templates.
const cases: { carrier: CarrierId; number: string; route: RegExp; marker: RegExp; provider?: string }[] = [
  { carrier: 'swiss-post', number: '989999999999999999',
    route: /^https:\/\/service\.post\.ch\/ekp-web\/ui\//,
    marker: /Meine Sendungen|My consignments|Mes envois|Sendungsnummer/ },
  { carrier: 'quickpac', number: '440000000000000001',
    route: /^https:\/\/tracking\.app\.planzer\.ch\/delivery\/info\?/,
    marker: /Mes envois|Meine Sendungen|My shipments|aucune information|keine Informationen/i },
  { carrier: 'la-poste', number: 'AB12345678901',
    route: /^https:\/\/www\.laposte\.fr\/outils\/suivre-vos-envois(?:\?|$)/,
    marker: /suivre un envoi|suivi de votre|numéro de suivi/i },
  { carrier: 'dpd', number: '09999999999999',
    route: /^https:\/\/www\.dpdgroup\.com\/ch\/mydpd\/my-parcels\/incoming\?/,
    marker: /parcel number|Paketnummer|numéro de colis|my parcels/i },
  { carrier: 'unknown', number: 'ZZ000000000ZZ',
    route: /^https:\/\/t\.17track\.net\/en(?:[?#]|$)/,
    marker: /TRACK|SUIVRE/ },
  { carrier: 'dhl', number: '00340439999999999999',
    route: /^https:\/\/www\.dhl\.de\/en\/privatkunden\/dhl-sendungsverfolgung\.html\?/,
    marker: /shipment number|track shipment/i },
  { carrier: 'mondial-relay', number: '00000000',
    route: /^https:\/\/www\.mondialrelay\.fr\/suivi-de-colis\//,
    marker: /suivi de colis|numéro de colis/i },
  { carrier: 'ups', number: '1Z0000000000000000',
    route: /^https:\/\/(?:www\.)?ups\.com\/track(?:[/?]|$)/,
    marker: /tracking number|numéro de suivi|track a package/i },
  { carrier: 'dhl-ecommerce', number: 'GM0000000000000000',
    route: /^https:\/\/www\.dhl\.com\/ch-en\/home\/tracking\.html\?/,
    marker: /tracking number|track your shipment/i },
  { carrier: 'india-post', number: 'EE000000000IN',
    route: /^https:\/\/myspeedpost\.com\/track\?/,
    marker: /consignment|speed post tracking/i },
  { carrier: 'spring-gds', number: 'LT000000000NL',
    route: /^https:\/\/postnl\.post\/track\?/,
    marker: /tracking numbers|track your parcels/i },
  { carrier: 'gls-de', number: '00000000000',
    route: /^https:\/\/(?:gls-group\.eu\/DE\/de\/paketverfolgung|www\.gls-pakete\.de\/(?:reach-)?sendungsverfolgung)/,
    marker: /Paketnummer|Sendungsverfolgung|Track ID/i },
  { carrier: 'aliexpress', number: 'LP00000000000000',
    route: /^https:\/\/global\.cainiao\.com\/detail\.htm\?/,
    marker: /Track|Suivre/ },
  { carrier: 'mondial-relay', provider: 'ParcelsApp', number: '00000000',
    route: /^https:\/\/parcelsapp\.com\/en\/tracking\//,
    marker: /tracking number|track package|tracking information/i },
];

describe('UI tracking links (rendered public pages)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: process.env.TRACKING_CHROMIUM_PATH || chromium.executablePath(),
      headless: true,
    });
  });
  afterAll(async () => { await browser?.close(); });

  it.for(cases.map((testCase) => ({ ...testCase, name: testCase.carrier + (testCase.provider ? '/' + testCase.provider : '') })))('$name opens a tracking page', { timeout: 45_000 }, async (testCase, context) => {
    const [link] = parcelTrackingLinks({
      carrier: testCase.carrier, trackingNumber: testCase.number,
      trackingProvider: testCase.provider,
    }, 'en');
    expect(link).toBeDefined();
    const page = await browser.newPage({ locale: 'en-US' });
    let lookupObserved = false;
    let documentStatus: number | undefined;
    page.on('response', (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        documentStatus = response.status();
      }
    });
    page.on('request', (request) => {
      if (['fetch', 'xhr'].includes(request.resourceType())
        && (request.url() + (request.postData() ?? '')).includes(testCase.number)) lookupObserved = true;
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
        const text = await page.locator('body').innerText({ timeout: 3000 });
        // DPD's server-rendered unknown-number view deliberately clears the
        // input. Its specific negative result plus retained parcelNumber is the
        // observed guest-flow outcome, not a generic homepage.
        const dpdUnknown = testCase.carrier === 'dpd'
          && new URL(page.url()).searchParams.get('parcelNumber') === testCase.number
          && /The parcel you have chosen has not been assigned to your account/.test(text);
        inputBound = lookupObserved || dpdUnknown || text.includes(testCase.number)
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
      expect(verdict, 'Expected a rendered tracker on its known route, not a homepage/error/challenge').toBe('tracking-page');
      expect(inputBound, 'The deep link must prefill, display or submit the synthetic tracking number').toBe(true);
    } finally {
      await page.close();
    }
  });
});
