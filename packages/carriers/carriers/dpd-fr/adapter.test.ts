import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepRecord, StepRecorder } from '../../core/telemetry';
import {
  DPDFranceChallengeError,
  DPDFranceTracker,
  DPDFranceTrackingError,
  adapter,
  dpdFranceTrackingUrl,
  normalizeDPDFranceTrackingNumber,
  parseDPDFranceTrackingHtml,
} from './adapter';
import { classifyStatus } from './status';

type Row = [date: string, clock: string, description: string, location: string];
type Detail = [label: string, value: string];

// Fully synthetic identifiers paired with provider-shaped HTML. The live suite
// verifies DPD France separately with a privacy-safe wrong-number canary.
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/claim-after-delivery.json', import.meta.url), 'utf8'),
) as {
  outboundNumber: string;
  returnNumber: string;
  outboundDetails: Detail[];
  returnDetails: Detail[];
  outboundRows: Row[];
  returnRows: Row[];
  privateSections: Record<string, string>;
};
const TEST_TRACKING_NUMBER = FIXTURE.outboundNumber;
const TEST_RETURN_NUMBER = FIXTURE.returnNumber;
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

function detailsBlock(id: string, details: Detail[]): string {
  const rows = details.map(([label, value]) => (
    `<ul class="tableInfosAR"><li><strong>${label}</strong></li><li class="tdInfos">${value}</li></ul>`
  )).join('');
  return `<div id="${id}">${rows}</div>`;
}

function traceRows(className: string, rows: Row[]): string {
  return rows.map(([date, clock, description, location]) => (
    `<tr class="${className}"><td>${date}</td><td>${clock}</td><td>${description}</td><td>${location}</td></tr>`
  )).join('');
}

function trackingFixture(overrides: {
  outboundNumber?: string;
  outboundRows?: Row[];
  outboundDetails?: Detail[];
} = {}): string {
  const outboundNumber = overrides.outboundNumber ?? TEST_TRACKING_NUMBER;
  const outboundDetails = (overrides.outboundDetails ?? FIXTURE.outboundDetails)
    .map(([label, value]): Detail => (label === 'N° colis' ? [label, outboundNumber] : [label, value]));
  const privateSections = Object.entries(FIXTURE.privateSections)
    .map(([id, value]) => `<div id="${id}">${value}</div>`).join('');
  return `<!doctype html><html><body>
    <div id="iconsAller">
      <span class="infosTitle parcelNumberAller">Votre colis ${outboundNumber}</span>
    </div>
    <span class="parcelNumberRetour">Votre colis ${TEST_RETURN_NUMBER}</span>
    ${detailsBlock('infos1', outboundDetails)}
    ${detailsBlock('infos2', FIXTURE.returnDetails)}
    <table id="tableTrace">
      ${traceRows('tabTraceColisAller', overrides.outboundRows ?? FIXTURE.outboundRows)}
      ${traceRows('tabTraceColisRetour', FIXTURE.returnRows)}
    </table>
    ${privateSections}
  </body></html>`;
}

function recordingRecorder(): { recorder: StepRecorder; steps: StepRecord[] } {
  const steps: StepRecord[] = [];
  return { steps, recorder: { step: (record) => { steps.push(record); }, lookup() {} } };
}

afterEach(() => vi.restoreAllMocks());

describe('DPD France tracking input', () => {
  it('accepts the official 12-to-15-digit formats and builds the public URL', () => {
    expect(normalizeDPDFranceTrackingNumber('1059 4002 3786 11')).toBe('10594002378611');
    expect(normalizeDPDFranceTrackingNumber('250.123.456.789.012')).toBe(TEST_TRACKING_NUMBER);
    expect(normalizeDPDFranceTrackingNumber('012345678901')).toBe('012345678901');
    expect(dpdFranceTrackingUrl(TEST_TRACKING_NUMBER))
      .toBe(`https://trace.dpd.fr/fr/trace/${TEST_TRACKING_NUMBER}`);
  });

  it('rejects unsafe or non-France identifiers', () => {
    for (const value of [
      '25012345678',
      '2501234567890120',
      '350123456789012',
      '25012345678901A',
      '250123456789012?admin=true',
    ]) {
      expect(() => normalizeDPDFranceTrackingNumber(value)).toThrow('12 to 15 digits');
    }
  });
});

describe('DPD France rendered tracking', () => {
  it('parses a provider-shaped fixture and excludes private page sections', () => {
    const result = parseDPDFranceTrackingHtml(trackingFixture(), TEST_TRACKING_NUMBER);

    expect(result).toMatchObject({
      status: 'exception',
      last_status_text: 'Nous avons reçu une réclamation : une enquête est ouverte',
      last_update: '2026-02-12T09:50:00+01:00',
      expected_delivery: null,
      timezone: 'Europe/Paris',
    });
    expect(result.events).toEqual([
      {
        time: '2026-02-12T09:50:00+01:00',
        location: 'Agence DPD de La Crau (283)',
        description: 'Nous avons reçu une réclamation : une enquête est ouverte',
        stage: 'exception',
      },
      {
        time: '2026-01-23T12:45:00+01:00',
        location: 'Livré au destinataire',
        description: 'Votre colis est livré',
        stage: 'delivered',
      },
      {
        time: '2026-01-23T08:31:00+01:00',
        location: 'Agence DPD de La Crau (283)',
        description: 'Votre colis est en cours de livraison',
        stage: 'out_for_delivery',
      },
      {
        time: '2026-01-22T16:16:00+01:00',
        location: 'Centre de tri DPD de Le Coudray (175)',
        description: 'Votre colis est arrivé en France',
        stage: 'in_transit',
      },
    ]);
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'private-order-reference',
      'Private return event',
      'Private Street',
      'Private Recipient',
      'private@example.test',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('returns every declared capability from one fixture', () => {
    const result = parseDPDFranceTrackingHtml(trackingFixture({
      outboundRows: FIXTURE.outboundRows.slice(2),
    }), TEST_TRACKING_NUMBER);

    expect(CAPABILITIES).toEqual(['history', 'location', 'eta']);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.expected_delivery).toBe('2026-01-24');
  });

  it('leaves unrecognized wording without a stage and falls back to the newest mapped row', () => {
    const result = parseDPDFranceTrackingHtml(trackingFixture({
      outboundRows: [
        ['13/02/2026', '07:05', 'Votre colis fait l’objet d’un traitement particulier', 'Agence DPD de La Crau (283)'],
        ...FIXTURE.outboundRows.slice(1),
      ],
    }), TEST_TRACKING_NUMBER);

    const [newest] = result.events ?? [];
    expect(newest?.description).toBe('Votre colis fait l’objet d’un traitement particulier');
    expect(newest && 'stage' in newest).toBe(false);
    // The unmapped row decides nothing: the newest recognized row still does.
    expect(result.status).toBe('delivered');
    expect(result.last_status_text).toBe('Votre colis fait l’objet d’un traitement particulier');
  });

  it('reports status unknown when no event wording is recognized', () => {
    const result = parseDPDFranceTrackingHtml(trackingFixture({
      outboundRows: [
        ['13/02/2026', '07:05', 'Votre colis fait l’objet d’un traitement particulier', 'Agence DPD de La Crau (283)'],
      ],
    }), TEST_TRACKING_NUMBER);

    expect(result.status).toBe('unknown');
    expect(result.events).toEqual([{
      time: '2026-02-13T07:05:00+01:00',
      location: 'Agence DPD de La Crau (283)',
      description: 'Votre colis fait l’objet d’un traitement particulier',
    }]);
  });

  it('rejects browser challenges, unknown shipments, and mismatched responses', () => {
    expect(() => parseDPDFranceTrackingHtml(
      '<title>Just a moment...</title><p>Performing security verification</p>',
      TEST_TRACKING_NUMBER,
    )).toThrow(DPDFranceChallengeError);
    expect(() => parseDPDFranceTrackingHtml(
      '<p>Nous ne sommes pas en mesure de retrouver le numéro de colis recherché.</p>',
      TEST_TRACKING_NUMBER,
    )).toThrow(DPDFranceTrackingError);
    expect(() => parseDPDFranceTrackingHtml(
      trackingFixture({ outboundNumber: '250123456789099' }),
      TEST_TRACKING_NUMBER,
    )).toThrow('different shipment');
  });

  it('selects the requested return leg without mixing outbound events', () => {
    const html = `<!doctype html><html><body>
      <span class="parcelNumberAller">Votre colis 10612345678900</span>
      <span class="parcelNumberRetour">Votre colis ${TEST_RETURN_NUMBER}</span>
      <div id="infos1"><ul class="tableInfosAR"><li><strong>N° colis</strong></li><li class="tdInfos">10612345678900</li></ul></div>
      <div id="infos2"><ul class="tableInfosAR"><li><strong>N° colis</strong></li><li class="tdInfos">${TEST_RETURN_NUMBER}</li></ul></div>
      <table id="tableTrace">
        <tr class="tabTraceColisAller"><td>18/11/2024</td><td>12:20</td><td>Votre colis est livré</td><td>Outbound location</td></tr>
        <tr class="tabTraceColisRetour"><td>19/11/2024</td><td>09:01</td><td>Votre colis est en transit dans notre réseau</td><td>Return location</td></tr>
      </table>
    </body></html>`;

    expect(parseDPDFranceTrackingHtml(html, TEST_RETURN_NUMBER)).toMatchObject({
      status: 'in_transit',
      events: [{ location: 'Return location', stage: 'in_transit' }],
    });
    expect(JSON.stringify(parseDPDFranceTrackingHtml(html, TEST_RETURN_NUMBER)))
      .not.toContain('Outbound location');
  });
});

describe('DPD France status vocabulary', () => {
  it('checks returns and incidents before the delivery wording', () => {
    expect(classifyStatus('Votre colis sera retourné à l’expéditeur'))
      .toEqual({ status: 'exception', stage: 'returned' });
    expect(classifyStatus('Votre colis est livré'))
      .toEqual({ status: 'delivered', stage: 'delivered' });
    expect(classifyStatus('Votre colis est disponible en relais'))
      .toEqual({ status: 'out_for_delivery', stage: 'ready_for_pickup' });
  });
});

describe('DPD France transport tiers', () => {
  it('uses direct HTTP when Cloudflare permits it', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      trackingFixture(),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    ));
    const { recorder, steps } = recordingRecorder();

    await expect(new DPDFranceTracker({ timeoutMs: 2_000, trawlUrl: '', recorder })
      .fetch(TEST_TRACKING_NUMBER)).resolves.toMatchObject({
        status: 'exception',
        tracking_url: dpdFranceTrackingUrl(TEST_TRACKING_NUMBER),
        tracking_source: 'rendered-page',
      });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toBe(dpdFranceTrackingUrl(TEST_TRACKING_NUMBER));
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      cache: 'no-store',
      redirect: 'follow',
    });
    expect(steps.map((step) => [step.step, step.outcome])).toEqual([['direct', 'ok']]);
  });

  it('falls back to the same TRAWL scrape protocol used for UPS', async () => {
    const challenge = new Response('<title>Just a moment...</title>', {
      status: 403,
      headers: { 'CF-Mitigated': 'challenge' },
    });
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(challenge)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tier: 3,
        statusCode: 200,
        html: trackingFixture(),
        cookies: [],
      }), { headers: { 'Content-Type': 'application/json' } }));
    const { recorder, steps } = recordingRecorder();

    await expect(new DPDFranceTracker({
      timeoutMs: 2_000,
      trawlUrl: 'http://trawl.internal:8191/v1',
      recorder,
    }).fetch(TEST_TRACKING_NUMBER)).resolves.toMatchObject({ status: 'exception' });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]![0])).toBe('http://trawl.internal:8191/scrape');
    const trawlRequest = JSON.parse(String(fetcher.mock.calls[1]![1]?.body));
    expect(trawlRequest).toEqual({
      url: dpdFranceTrackingUrl(TEST_TRACKING_NUMBER),
      skipHttp: true,
      maxTier: 3,
      maxTimeout: 2_000,
    });
    expect(steps.map((step) => [step.step, step.outcome])).toEqual([['direct', 'challenge'], ['trawl', 'ok']]);
    expect(steps[1]).toMatchObject({ fallbackFrom: 'direct', fallbackReason: 'challenge' });
  });

  it('surfaces an actionable error when no browser solver is configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      '<title>Just a moment...</title>',
      { status: 403, headers: { 'CF-Mitigated': 'challenge' } },
    ));
    const { recorder, steps } = recordingRecorder();

    await expect(new DPDFranceTracker({ timeoutMs: 2_000, trawlUrl: '', recorder })
      .fetch(TEST_TRACKING_NUMBER)).rejects.toThrow('configure FLARESOLVERR_URL');
    // The missing tier is a disabled step, not a failed one.
    expect(steps.map((step) => step.step)).toEqual(['direct']);
  });
});

describe('DPD France adapter factory', () => {
  it('declares both tiers and tracks through the direct page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(trackingFixture()));
    const { recorder } = recordingRecorder();
    const instance = adapter({ trawl: null, browserExecutablePath: null, recorder, env: {} });

    expect(instance.id).toBe('dpd-fr');
    expect(instance.steps).toEqual(['direct', 'trawl']);
    await expect(instance.track({ number: TEST_TRACKING_NUMBER }))
      .resolves.toMatchObject({ status: 'exception' });
  });
});
