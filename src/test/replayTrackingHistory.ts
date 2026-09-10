import { vi } from 'vitest';
import { parseDHLTrackingResponse } from '../server/dhl';
import { parseDHLEcommerceResponse } from '../server/dhlEcommerce';
import { parseLaPosteTrackingResponse } from '../server/laPoste';
import { parseSwissPostShipment } from '../server/swissPost';
import { parseGLSSwitzerlandTrackingResponse } from '../server/glsSwitzerland';
import { classifyIndiaPostEvent } from '../server/indiaPost';
import { fetchPlanzer, fetchPostNL } from '../server/upstreamAdapters';
import { event } from '../server/universalTrackingResult';
import type { CarrierResult } from '../server/carrierResult';

const NUMBER = 'AB12345678901';
const TIME = '2026-01-01T12:00:00Z';
export type AuditedScan = { provider: string; description: string; code?: string; expected: string };

// Descriptions/codes were reviewed from stored history. The surrounding provider
// envelopes, numbers and dates below are synthetic, not captured customer data.
export async function replayAuditedScan(scan: AuditedScan, translatedDescription?: string): Promise<CarrierResult> {
  const { provider, code } = scan;
  const description = translatedDescription ?? scan.description;
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
      const statusCode = /^(CLOSE BAG|SCANNED INTO SACK\/CONTAINER)$/.test(scan.description)
        ? 'unknown' : 'transit';
      const providerEvent = { timestamp: TIME, description, statusCode };
      return parseDHLEcommerceResponse({ shipments: [{
        id: NUMBER, service: 'ecommerce', status: providerEvent, events: [providerEvent],
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
      if (scan.description === 'Paket wurde elektronisch angekündigt') return { events };
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
          category: /pre-advised|shippers warehouse/.test(scan.description) ? 'Pre-advised' : 'Transit',
        }] }] } }));
      return fetchPostNL(NUMBER);
    case 'dpd':
    case 'ups':
      return { status: 'delivered', events };
    default:
      throw new Error('Add an explicit replay path for this provider');
  }
}
