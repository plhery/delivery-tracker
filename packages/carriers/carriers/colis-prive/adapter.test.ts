import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, SchemaError } from '../../core/errors';
import {
  ColisPriveTracker,
  ColisPriveTrackingError,
  colisPriveTrackingUrl,
  normalizeColisPriveCredential,
  parseColisPriveTrackingHtml,
} from './adapter';
import { classifyStatus } from './status';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_SYNTHETIC_CREDENTIAL = '99112233445575012';
const CAPABILITIES: readonly string[] = JSON.parse(
  readFileSync(path.join(here, 'carrier.json'), 'utf8'),
).capabilities;

interface PageFixture {
  shipment: string;
  status: string;
  rows: Array<[string, string]>;
  recipientBlock: string[];
  recipientContact: string;
}

const FIXTURE: PageFixture = JSON.parse(
  readFileSync(path.join(here, 'fixtures', 'failed-attempt.json'), 'utf8'),
);

function trackingPage(options: {
  shipment?: string;
  status?: string;
  rows?: Array<[string, string]>;
} = {}): string {
  const shipment = options.shipment ?? FIXTURE.shipment;
  const status = options.status ?? FIXTURE.status;
  const rows = options.rows ?? FIXTURE.rows;
  return `<!doctype html>
    <html><body>
      <div class="BandeauInfoColis">
        <div class="divColis"><div class="tdText">${shipment}</div></div>
        <div class="divStatut"><div class="tdText">${status}</div></div>
        <div class="divDesti"><div class="tdText">
          ${FIXTURE.recipientBlock.join('<br>')}
        </div></div>
      </div>
      <table class="tableHistoriqueColis">
        ${rows.map(([date, description]) => `
          <tr class="bandeauText">
            <td class="tdText" headers="th-date">${date}</td>
            <td class="tdText" headers="th-statut">${description}</td>
          </tr>`).join('')}
      </table>
      <div class="recipient-contact">${FIXTURE.recipientContact}</div>
    </body></html>`;
}

afterEach(() => vi.restoreAllMocks());

describe('Colis Privé combined tracking credential', () => {
  it('accepts only 12 alphanumeric shipment characters followed by a 5-digit postcode', () => {
    expect(normalizeColisPriveCredential(`  ${PUBLIC_SYNTHETIC_CREDENTIAL}  `))
      .toBe(PUBLIC_SYNTHETIC_CREDENTIAL);
    expect(normalizeColisPriveCredential('ab123456789075001')).toBe('AB123456789075001');

    for (const value of [
      '991122334455',
      '9911223344557501',
      '991122334455750123',
      '991122334455ABCDE',
      '9911223344557501É',
      '99112233445575012&admin=true',
      '991 122 334 455 75012',
      '99112233445500000',
      '99112233445596000',
      '99112233445599000',
    ]) {
      expect(() => normalizeColisPriveCredential(value)).toThrow('12-character shipment number');
    }
  });

  it('builds the official detail URL without allowing parameter injection', () => {
    const url = new URL(colisPriveTrackingUrl(PUBLIC_SYNTHETIC_CREDENTIAL));
    expect(url.origin).toBe('https://colisprive.com');
    expect(url.pathname).toBe('/moncolis/pages/DetailColis.aspx');
    expect(url.searchParams.get('numColis')).toBe(PUBLIC_SYNTHETIC_CREDENTIAL);
    expect(url.searchParams.get('lang')).toBe('fr');
    expect([...url.searchParams]).toHaveLength(2);
  });
});

describe('Colis Privé wording classifier', () => {
  it('checks the exception wording before the delivery wording', () => {
    expect(classifyStatus('Nous avons tenté de livrer votre colis.'))
      .toEqual({ status: 'exception', stage: 'failed_attempt' });
    expect(classifyStatus('Votre colis a été livré en boîte aux lettres'))
      .toEqual({ status: 'delivered', stage: 'delivered' });
    expect(classifyStatus("Votre colis est retourné à l'expéditeur"))
      .toEqual({ status: 'exception', stage: 'returned' });
  });

  it('leaves wording it does not know unmapped', () => {
    expect(classifyStatus('Une phrase que le transporteur vient d’ajouter'))
      .toEqual({ status: 'unknown' });
  });
});

describe('Colis Privé HTML normalization', () => {
  it('verifies the requested shipment and parses status history without retaining recipient data', () => {
    const result = parseColisPriveTrackingHtml(
      trackingPage(),
      PUBLIC_SYNTHETIC_CREDENTIAL,
    );

    expect(result).toMatchObject({
      status: 'exception',
      last_status_text: 'Nous avons tenté de livrer votre colis.',
      last_update: '28/08/2026',
      expected_delivery: null,
      timezone: 'Europe/Paris',
    });
    expect(result.events).toEqual([
      {
        time: '28/08/2026',
        location: '',
        description: 'Nous avons tenté de livrer votre colis.',
        stage: 'failed_attempt',
      },
      {
        time: '28/08/2026',
        location: '',
        description: 'Votre colis est en cours de distribution par le livreur',
        stage: 'out_for_delivery',
      },
      {
        time: '26/08/2026',
        location: '',
        description: 'Votre colis est arrivé sur notre agence régionale de distribution.',
        stage: 'in_transit',
      },
      {
        time: '25/08/2026',
        location: '',
        description: "Votre colis est en cours de préparation par l'expéditeur.",
        stage: 'registered',
      },
    ]);
    const serialized = JSON.stringify(result);
    for (const privateValue of [...FIXTURE.recipientBlock, FIXTURE.recipientContact]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('returns every capability declared in carrier.json', () => {
    const result = parseColisPriveTrackingHtml(trackingPage(), PUBLIC_SYNTHETIC_CREDENTIAL);
    const checks: Record<string, () => boolean> = {
      history: () => (result.events?.length ?? 0) > 0,
    };
    expect(CAPABILITIES.length).toBeGreaterThan(0);
    for (const capability of CAPABILITIES) {
      expect(checks[capability], `no check for capability ${capability}`).toBeDefined();
      expect(checks[capability]!(), `capability ${capability} is declared but never returned`).toBe(true);
    }
  });

  it('emits an unmapped row without a stage', () => {
    const result = parseColisPriveTrackingHtml(trackingPage({
      status: 'Un nouveau libellé du transporteur',
      rows: [['29/08/2026', 'Un nouveau libellé du transporteur']],
    }), PUBLIC_SYNTHETIC_CREDENTIAL);
    expect(result.status).toBe('unknown');
    expect(result.events).toEqual([{
      time: '29/08/2026',
      location: '',
      description: 'Un nouveau libellé du transporteur',
    }]);
  });

  it('maps delivered and relay-pickup statuses', () => {
    const delivered = parseColisPriveTrackingHtml(trackingPage({
      status: 'Votre colis a été livré en boîte aux lettres',
      rows: [['29/08/2026', 'Votre colis a été livré en boîte aux lettres']],
    }), PUBLIC_SYNTHETIC_CREDENTIAL);
    expect(delivered.status).toBe('delivered');
    expect(delivered.events).toEqual([expect.objectContaining({ stage: 'delivered' })]);

    const pickup = parseColisPriveTrackingHtml(trackingPage({
      status: 'Votre colis vous attend au relais',
      rows: [['29/08/2026', 'Votre colis vous attend au relais']],
    }), PUBLIC_SYNTHETIC_CREDENTIAL);
    expect(pickup.status).toBe('out_for_delivery');
    expect(pickup.events).toEqual([expect.objectContaining({ stage: 'ready_for_pickup' })]);
  });

  it('rejects mismatched, incomplete, and malformed success pages', () => {
    expect(() => parseColisPriveTrackingHtml(
      trackingPage({ shipment: '123 456 789 012' }),
      PUBLIC_SYNTHETIC_CREDENTIAL,
    )).toThrow(SchemaError);
    expect(() => parseColisPriveTrackingHtml(
      trackingPage({ shipment: '123 456 789 012' }),
      PUBLIC_SYNTHETIC_CREDENTIAL,
    )).toThrow('different shipment');
    expect(() => parseColisPriveTrackingHtml(
      '<html><body>Generic home page</body></html>',
      PUBLIC_SYNTHETIC_CREDENTIAL,
    )).toThrow('did not return tracking details');
    expect(() => parseColisPriveTrackingHtml(
      trackingPage({ status: '' }),
      PUBLIC_SYNTHETIC_CREDENTIAL,
    )).toThrow('did not return a shipment status');
  });
});

describe('Colis Privé tracker', () => {
  it('uses a bounded no-redirect request and parses a matching page', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(trackingPage(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }));

    await expect(new ColisPriveTracker({ timeoutMs: 1_000 }).fetch(PUBLIC_SYNTHETIC_CREDENTIAL))
      .resolves.toMatchObject({ status: 'exception', last_update: '28/08/2026' });

    const requested = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(requested.searchParams.get('numColis')).toBe(PUBLIC_SYNTHETIC_CREDENTIAL);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', redirect: 'manual' });
  });

  it('surfaces provider redirects and 404 responses as privacy-safe not-found errors', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    fetcher.mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: '/moncolis/Default.aspx' },
    }));
    await expect(new ColisPriveTracker().fetch(PUBLIC_SYNTHETIC_CREDENTIAL)).rejects.toMatchObject({
      name: 'ColisPriveTrackingError',
      message: 'Colis Privé could not locate the shipment',
      kind: 'not_found',
      status: 404,
    });
    expect(new ColisPriveTrackingError()).toBeInstanceOf(NotFoundError);
    expect(new ColisPriveTrackingError()).toMatchObject({ status: 404 });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });

    fetcher.mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    await expect(new ColisPriveTracker().fetch(PUBLIC_SYNTHETIC_CREDENTIAL))
      .rejects.toMatchObject({ status: 404 });
  });
});
