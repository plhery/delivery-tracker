import { afterEach, describe, expect, it, vi } from 'vitest';
import history from './fixtures/auditedTrackingHistory.json';
import { buildEvents } from './trackingSync';
import { parseDHLTrackingResponse } from './dhl';
import { parseDHLEcommerceResponse } from './dhlEcommerce';
import { parseLaPosteTrackingResponse } from './laPoste';
import { parseSwissPostShipment } from './swissPost';
import { parseGLSSwitzerlandTrackingResponse } from './glsSwitzerland';
import { classifyIndiaPostEvent } from './indiaPost';
import { fetchPlanzer, fetchPostNL } from './upstreamAdapters';
import { event } from './universalTrackingResult';
import type { CarrierResult } from './carrierResult';

const NUMBER = 'AB12345678901';
const TIME = '2026-01-01T12:00:00Z';
type Scan = { provider: string; description: string; code?: string; expected: string };

// Descriptions/codes were reviewed from stored history. The surrounding provider
// envelopes, numbers and dates below are synthetic, not captured customer data.
async function replay(scan: Scan): Promise<CarrierResult> {
  const { provider, description, code } = scan;
  const events = [{ time: TIME, description }];
  switch (provider) {
    case 'dhl':
      return parseDHLTrackingResponse({ sendungen: [{
        id: NUMBER, sendungsdetails: { istZugestellt: true, sendungsverlauf: {
          events: [{ datum: TIME, status: description }],
        } },
      }] }, NUMBER);
    case 'dhl-ecommerce': {
      // Exercise the two observed unclassified handling scans with no coarse
      // status; ordinary transit events also carry DHL's documented coarse code.
      const statusCode = /^(CLOSE BAG|SCANNED INTO SACK\/CONTAINER)$/.test(description)
        ? 'unknown' : 'transit';
      const scan = { timestamp: TIME, description, statusCode };
      return parseDHLEcommerceResponse({ shipments: [{
        id: NUMBER, service: 'ecommerce', status: scan, events: [scan],
      }] });
    }
    case 'la-poste': {
      const [group, eventCode] = code?.includes('/') ? code.split('/') : ['', code];
      return parseLaPosteTrackingResponse([{ returnCode: 0, shipment: {
        idShip: NUMBER, isFinal: true,
        event: [{ date: TIME, label: description, group, code: eventCode }],
      } }], NUMBER);
    }
    case 'swiss-post':
      return code ? parseSwissPostShipment({ globalStatus: 'DELIVERED' }, [{
        eventCode: code, timestamp: TIME, externalMetadata: { description },
      }]) : { status: 'delivered', events };
    case 'gls-de':
      return parseGLSSwitzerlandTrackingResponse({
        tuNo: '12345678901', progressBar: { statusInfo: 'DELIVERED', statusText: 'Delivered' },
        history: [{ date: '2026-01-01', time: '12:00', evtDscr: description }],
      }, '12345678901');
    case 'india-post':
      return { events: [{ ...events[0], stage: classifyIndiaPostEvent(code, description).stage }] };
    case 'ParcelsApp':
      return { events: [event(TIME, description)!] };
    case 'quickpac':
      if (description === 'Paket wurde elektronisch angekündigt') return { events };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
        overallStatus: { text: { english: 'Shipment delivered' } },
        transportPositions: [{ positionNumber: NUMBER,
          positionEvents: [{ createdAt: TIME, text: { english: description } }] }],
      }));
      return fetchPlanzer(NUMBER);
    case 'spring-gds':
      // PostNL's category takes precedence over its free-text label. These
      // synthetic categories exercise the observed pre-advice/transit grouping.
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(Response.json({ access_token: 'synthetic-visitor-token' }))
        .mockResolvedValueOnce(Response.json({ data: { items: [{ item: NUMBER, events: [{
          datetime_local: TIME, status_description: description,
          category: /pre-advised|shippers warehouse/.test(description) ? 'Pre-advised' : 'Transit',
        }] }] } }));
      return fetchPostNL(NUMBER);
    case 'dpd':
    case 'ups':
      return { status: 'delivered', events };
    default:
      throw new Error('Add an explicit replay path for this provider');
  }
}

afterEach(() => vi.restoreAllMocks());

describe('anonymized audited tracking histories', () => {
  it('does not turn negated customs release into completed clearance', () => {
    expect(event(TIME, 'Customs not cleared')?.stage).toBe('customs');
    expect(event(TIME, 'Customs clearance not completed')?.stage).toBe('customs');
    expect(event(TIME, 'Carrier-specific wording')?.stage).toBe('pending');
  });
  it.each(history)('$provider: $description ($code)', async (scan) => {
    const parsed = await replay(scan);
    const rows = buildEvents({ id: 'synthetic-package', carrier: scan.provider }, parsed);
    expect(rows[0]?.stage).toBe(scan.expected);
  });
});
