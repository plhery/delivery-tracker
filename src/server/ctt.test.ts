import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeCttTrackingNumber,
  cttTrackingUrl,
  parseCttTrackingResponse,
  CttTracker,
  CttMaintenanceError,
} from './ctt';
import { buildEvents } from './trackingSync';

// All identifiers and timestamps below are synthetic. Portuguese status labels
// reuse the vendor's fixed texts observed live on a real delivered parcel, so
// classification exercises production wording rather than paraphrases.
const TRACKING_NUMBER = 'RL000000005PT';
const SCREEN_SCRIPT = [
  'callDataAction("DataActionGetObjectEventsByInputObjectCode", "screenservices/x", "apiv-track-1", function (b) {}',
  'callDataAction("DataActionCheckIPLocked", "screenservices/x", "apiv-maint-1", function (b) {}',
].join('\n');

function record(overrides: Record<string, unknown> = {}) {
  return {
    ObjectCode: TRACKING_NUMBER,
    Found: true,
    IsTracked: true,
    ShipmentProduct: 'Test Product',
    Sender: 'Secret Sender',
    Recipient: 'Secret Recipient',
    Events: {
      List: [
        { DateTime: '2026-01-01T08:00:00+00:00', State: 'Aceite', StateId: 2, Event: 'Shipment accepted', EventCode: 'EMA', Local: 'Test Depot' },
        { DateTime: '2026-01-04T14:46:00+00:00', State: 'Entregue', StateId: 12, Event: 'Delivered parcel', EventCode: 'EMI', Local: 'Test Depot' },
      ],
    },
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

interface CttScenario {
  record?: Record<string, unknown> | null;
  maintenance?: boolean;
  staleFirst?: boolean;
  noCookie?: boolean;
  calls?: string[];
}

/** Programmable stand-in for the OutSystems session flow. */
function mockCttFlow(scenario: CttScenario) {
  const calls: string[] = [];
  scenario.calls = calls;
  let trackCalls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url.includes('moduleversioninfo')) return jsonResponse({ versionToken: 'mv-1' });
    if (url.includes('moduleinfo')) {
      return jsonResponse({ manifest: { urlVersions: { '/CustomerArea/scripts/CustomerArea.CustomerArea.PublicArea_Detail.mvc.js': '?s-1' } } });
    }
    if (url.includes('.mvc.js')) return new Response(SCREEN_SCRIPT, { headers: { 'Content-Type': 'application/javascript' } });
    if (url.includes('DataActionCheckIPLocked')) {
      return jsonResponse({ data: { IsMaintenance: scenario.maintenance === true }, versionInfo: {} });
    }
    if (url.includes('DataActionGetObjectEventsByInputObjectCode')) {
      trackCalls += 1;
      const headers = new Headers(init?.headers);
      if (!headers.get('Cookie')) {
        if (scenario.noCookie) return new Response('{}', { status: 403 });
        return new Response('{}', {
          status: 403,
          headers: { 'Set-Cookie': 'nr2Users=crf%3dTOKEN123%3buid%3d0%3bunm%3d; Path=/' },
        });
      }
      if (headers.get('X-CSRFToken') !== 'TOKEN123') {
        return new Response('{}', { status: 403 });
      }
      if (scenario.staleFirst && trackCalls === 2) {
        return jsonResponse({ versionInfo: { hasModuleVersionChanged: false, hasApiVersionChanged: true }, data: {} });
      }
      return jsonResponse({
        versionInfo: { hasModuleVersionChanged: false, hasApiVersionChanged: false },
        data: { ObjectEventsFromQuery: scenario.record === undefined ? record() : scenario.record },
      });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
  return { trackCalls: () => trackCalls };
}

afterEach(() => vi.restoreAllMocks());

describe('CTT tracking normalization', () => {
  it('accepts checksum-valid S10 PT and rejects the rest', () => {
    expect(normalizeCttTrackingNumber('rl000000005pt')).toBe(TRACKING_NUMBER);
    expect(normalizeCttTrackingNumber('RL402552798PT')).toBe('RL402552798PT');
    for (const raw of ['RL000000006PT', 'RL000000005GB', '12345', '']) {
      expect(() => normalizeCttTrackingNumber(raw)).toThrow(TypeError);
    }
    expect(cttTrackingUrl(TRACKING_NUMBER)).toBe(
      'https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects=RL000000005PT',
    );
  });
});

describe('CTT response parsing', () => {
  it('returns delivered history newest-first with identity binding', () => {
    const result = parseCttTrackingResponse({ data: { ObjectEventsFromQuery: record() } }, TRACKING_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered parcel',
      last_update: '2026-01-04T14:46:00Z',
      expected_delivery: null,
    });
    expect(result.events?.map((event) => [event.description, event.stage, event.time])).toEqual([
      ['Delivered parcel', 'delivered', '2026-01-04T14:46:00Z'],
      ['Shipment accepted', 'in_transit', '2026-01-01T08:00:00Z'],
    ]);
  });

  it('maps every documented StateId and reports unmapped ones as unknown', () => {
    const cases: Array<[number, string, string]> = [
      [1, 'pending', 'registered'],
      [2, 'in_transit', 'in_transit'],
      [5, 'exception', 'returned'],
      [7, 'out_for_delivery', 'out_for_delivery'],
      [8, 'in_transit', 'in_transit'],
      [10, 'in_transit', 'in_transit'],
      [11, 'in_transit', 'in_transit'],
      [12, 'delivered', 'delivered'],
      [13, 'exception', 'failed_attempt'],
      [14, 'out_for_delivery', 'ready_for_pickup'],
    ];
    for (const [stateId, status, stage] of cases) {
      const result = parseCttTrackingResponse({ data: { ObjectEventsFromQuery: record({
        Events: { List: [{ DateTime: '2026-01-04T14:46:00+00:00', State: 'X', StateId: stateId, Event: 'Wording', EventCode: 'EXX', Local: '' }] },
      }) } }, TRACKING_NUMBER);
      expect(result).toMatchObject({ status, current_stage: stage });
    }
    const unknown = parseCttTrackingResponse({ data: { ObjectEventsFromQuery: record({
      Events: { List: [{ DateTime: '2026-01-04T14:46:00+00:00', State: 'X', StateId: 99, Event: 'New wording', EventCode: 'EXX', Local: '' }] },
    }) } }, TRACKING_NUMBER);
    expect(unknown).toMatchObject({ status: 'unknown', last_status_text: 'New wording' });
    expect(unknown.events?.[0]).toMatchObject({ description: 'New wording', provider_code: '99' });
    expect(unknown.events?.[0]?.stage).toBeUndefined();
    // The sync classifies the unmapped wording and records where the stage came from.
    expect(buildEvents({ id: 'parcel', carrier: 'ctt' }, unknown)[0]).toMatchObject({
      stage: 'in_transit',
      raw_data: expect.objectContaining({ stage_source: 'none' }),
    });
  });

  it('binds the ObjectCode echo and rejects malformed envelopes', () => {
    expect(() => parseCttTrackingResponse({ data: { ObjectEventsFromQuery: record({ ObjectCode: 'RL000000006PT' }) } }, TRACKING_NUMBER))
      .toThrow(RangeError);
    expect(() => parseCttTrackingResponse({ data: { ObjectEventsFromQuery: record({ ObjectCode: undefined }) } }, TRACKING_NUMBER))
      .toThrow(TypeError);
    expect(() => parseCttTrackingResponse({ data: { ObjectEventsFromQuery: record({ Events: {} }) } }, TRACKING_NUMBER))
      .toThrow(TypeError);
    expect(() => parseCttTrackingResponse({ data: {} }, TRACKING_NUMBER)).toThrow(TypeError);
    expect(() => parseCttTrackingResponse(null, TRACKING_NUMBER)).toThrow(TypeError);
  });

  it('skips unusable rows without losing the shipment', () => {
    const result = parseCttTrackingResponse({ data: { ObjectEventsFromQuery: record({
      Events: { List: [
        { DateTime: '2026-01-04T14:46:00Z', State: 'Entregue', StateId: 12, Event: 'Delivered parcel', EventCode: 'EMI', Local: 'Test Depot' },
        { DateTime: '2026-01-04T14:46:00Z', State: 'Entregue', StateId: 12, Event: 'Delivered parcel', EventCode: 'EMI', Local: 'Test Depot' },
        { DateTime: 'not a date', State: 'X', StateId: 12, Event: 'Broken time', EventCode: 'EMI', Local: '' },
        // Empty wording falls back to the State label, so this row survives.
        { DateTime: '2026-01-03T10:00:00Z', State: 'Em trânsito', StateId: 11, Event: '', EventCode: 'EMC', Local: '' },
        'not a record',
      ] },
    }) } }, TRACKING_NUMBER);
    expect(result.events?.map((event) => event.description)).toEqual(['Delivered parcel', 'Em trânsito']);
  });

  it('never retains sender or recipient identity blocks', () => {
    const result = parseCttTrackingResponse({ data: { ObjectEventsFromQuery: record() } }, TRACKING_NUMBER);
    const serialized = JSON.stringify(result);
    for (const secret of ['Secret Sender', 'Secret Recipient', 'SenderEmail', 'RecipientAddress', 'ReceptorName']) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('CttTracker fetch', () => {
  it('bootstraps the session from the 403 cookie and binds the record', async () => {
    const scenario: CttScenario = {};
    mockCttFlow(scenario);
    const result = await new CttTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER);
    expect(result.status).toBe('delivered');
    expect(scenario.calls?.filter((call) => call.includes('DataActionGetObjectEventsByInputObjectCode'))).toHaveLength(2);
    expect(scenario.calls?.some((call) => call.includes('moduleversioninfo'))).toBe(true);
  });

  it('reports genuine not-found only after the maintenance check clears', async () => {
    const scenario: CttScenario = { record: { ObjectCode: TRACKING_NUMBER, Found: false, Events: { List: [] } }, maintenance: false };
    mockCttFlow(scenario);
    await expect(new CttTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ name: 'CttTrackingError', status: 404 });
    expect(scenario.calls?.some((call) => call.includes('DataActionCheckIPLocked'))).toBe(true);
  });

  it('turns a maintenance outage into a retryable error instead of not-found', async () => {
    mockCttFlow({ record: { ObjectCode: TRACKING_NUMBER, Found: false, Events: { List: [] } }, maintenance: true });
    await expect(new CttTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toBeInstanceOf(CttMaintenanceError);
  });

  it('re-derives rotated version tokens once and fails bootstrap loops fast', async () => {
    const scenario: CttScenario = { staleFirst: true };
    mockCttFlow(scenario);
    const result = await new CttTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER);
    expect(result.status).toBe('delivered');
    expect(scenario.calls?.filter((call) => call.includes('moduleversioninfo'))).toHaveLength(2);
    mockCttFlow({ noCookie: true });
    await expect(new CttTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toThrow('anonymous session bootstrap failed');
  });

  it('surfaces transport and input failures distinctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(new CttTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ name: 'UpstreamHttpError', status: 503 });
    expect(() => new CttTracker({ timeoutMs: 0 })).toThrow(TypeError);
    await expect(new CttTracker({ timeoutMs: 1_000 }).fetch('nope'))
      .rejects.toThrow(TypeError);
  });
});
