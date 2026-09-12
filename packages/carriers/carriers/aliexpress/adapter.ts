import 'server-only';

/**
 * AliExpress / Cainiao tracking.
 *
 * Cainiao's public shipment detail endpoint (`global.cainiao.com/global/
 * detail.json`) is the same keyless JSON the consumer tracking page reads. One
 * GET returns every requested `mailNo` as a module, so the adapter selects the
 * module whose identifier equals the number that was asked for and refuses
 * anything else: the endpoint happily echoes other shipments when the query is
 * malformed, and showing a stranger's parcel would be worse than an error.
 *
 * A module with no status, no history and no latest trace is genuinely unknown
 * only when `mailNoSource` is `EXTERNAL`; otherwise Cainiao is still waiting
 * for the seller and the parcel is simply pending.
 */
import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import {
  CAINIAO_ACTION_STATUS,
  CAINIAO_STATUS,
  cainiaoActionCode,
  cainiaoStageByStatus,
} from './status';

const PROVIDER = 'Cainiao';
const UPSTREAM = 'Cainiao tracking';
const DETAIL_URL = 'https://global.cainiao.com/global/detail.json';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_EVENTS_TO_RETURN = 20;
const BASE_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (compatible; SwissDeliveryTracker/1.0)',
};

function record(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function recordArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function comparableIdentifier(value: unknown): string {
  return text(value).toLocaleUpperCase('en-US').replace(/[^A-Z0-9]/g, '');
}

/**
 * The partner number Cainiao hands the parcel over with, when it publishes
 * one. `copyRealMailNo` is the machine-readable field; `realMailNo` is display
 * prose that sometimes wraps the same identifier in a sentence.
 */
function cainiaoHandoffNumber(trackingModule: JsonObject): string {
  const direct = text(trackingModule.copyRealMailNo).trim();
  if (/^(?=.*\d)[A-Z0-9]{8,30}$/i.test(direct.replace(/[\s.-]/g, ''))) {
    return direct.replace(/\s+/g, ' ').trim();
  }
  const display = text(trackingModule.realMailNo);
  const match = /(?<![A-Z0-9])(?=[A-Z0-9]*\d)[A-Z0-9]{8,30}(?![A-Z0-9])/i.exec(display);
  return match?.[0] ?? '';
}

/** Projects one `detail.json` payload. Pure: the offline tests target this. */
export function parseCainiaoTrackingResponse(value: unknown, trackingNumber: string): CarrierResult {
  const payload = record(value);
  const rawModules = Array.isArray(payload.module)
    ? payload.module
    : Array.isArray(payload.data) ? payload.data : null;
  if (!rawModules) throw new SchemaError(PROVIDER, 'Cainiao returned an invalid tracking response');
  const modules = recordArray(rawModules);
  if (modules.length !== rawModules.length) {
    throw new SchemaError(PROVIDER, 'Cainiao returned an invalid shipment entry');
  }
  if (modules.length === 0) throw new SchemaError(PROVIDER, 'Cainiao did not return a shipment entry');
  const requested = comparableIdentifier(trackingNumber);
  const identified = modules.filter((module) => comparableIdentifier(module.mailNo));
  if (identified.length === 0) throw new SchemaError(PROVIDER, 'Cainiao did not return a shipment identifier');
  const trackingModule = identified.find(
    (module) => comparableIdentifier(module.mailNo) === requested,
  );
  if (!trackingModule) throw new SchemaError(PROVIDER, 'Cainiao returned a different shipment');
  const rawStatus = text(trackingModule.status);
  const latest = record(trackingModule.latestTrace ?? trackingModule.globalCombinedLogisticsTraceDTO);
  const rawDetails = trackingModule.detailList;
  if (rawDetails !== undefined && !Array.isArray(rawDetails)) {
    throw new SchemaError(PROVIDER, 'Cainiao returned invalid tracking history');
  }
  const details = recordArray(rawDetails);
  if (Array.isArray(rawDetails) && details.length !== rawDetails.length) {
    throw new SchemaError(PROVIDER, 'Cainiao returned an invalid tracking event');
  }
  if (Array.isArray(rawDetails)
    && !rawStatus
    && details.length === 0
    && Object.keys(latest).length === 0) {
    // Only an externally issued number can be positively unknown here; an
    // internal one is a shipment the seller has not handed over yet.
    if (text(trackingModule.mailNoSource).toLocaleUpperCase('en-US') === 'EXTERNAL') {
      throw new NotFoundError(PROVIDER);
    }
  }
  const status = cainiaoActionCode(latest.actionCode)
    ? (CAINIAO_ACTION_STATUS.get(cainiaoActionCode(latest.actionCode)) ?? 'unknown')
    : (CAINIAO_STATUS.get(rawStatus)
      ?? (rawStatus ? 'in_transit' : details.length === 0 ? 'pending' : 'unknown'));
  const latestAction = cainiaoActionCode(latest.actionCode);
  const actionStage = cainiaoStageByStatus(latestAction);
  const events = details.slice(0, MAX_EVENTS_TO_RETURN).map((event): CarrierEvent => {
    const code = cainiaoActionCode(event.actionCode);
    const mapped = code ? CAINIAO_ACTION_STATUS.get(code) : undefined;
    return {
      time: text(event.timeStr),
      location: '',
      description: text(event.standerdDesc) || text(event.desc),
      ...(mapped ? { stage: actionStage[mapped] ?? 'in_transit' } : {}),
    };
  });
  const eta = record(trackingModule.globalEtaInfo);
  const toMillis = (value_: unknown): number | null => (
    typeof value_ === 'number' && Number.isFinite(value_) ? value_ : null
  );
  const deliveryMinTime = toMillis(eta.deliveryMinTime);
  const deliveryMaxTime = toMillis(eta.deliveryMaxTime);
  const toDate = (millis: number | null): string | null => (
    millis == null ? null : new Date(millis).toISOString().slice(0, 10)
  );
  const expected = toDate(deliveryMaxTime);
  const expectedFrom = toDate(deliveryMinTime);
  const handoff = cainiaoHandoffNumber(trackingModule);
  const deliveredAt = status === 'delivered' ? text(latest.timeStr) || null : null;
  return {
    status,
    ...(actionStage[status] || status === 'in_transit' ? { current_stage: actionStage[status] ?? 'in_transit' } : {}),
    last_status_text: text(latest.standerdDesc) || text(latest.desc) || rawStatus,
    last_update: text(latest.timeStr) || null,
    expected_delivery: status === 'delivered' ? null : expected,
    ...(status === 'delivered' || expectedFrom == null || expectedFrom === expected
      ? {}
      : { expected_delivery_from: expectedFrom }),
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
    ...(handoff ? { delivery_tracking_number: handoff } : {}),
    events,
  };
}

export class CainiaoTracker {
  private readonly fetcher: typeof fetch | undefined;
  private readonly timeoutMs: number;

  constructor(options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetcher = options.fetcher;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const { bytes } = await fetchBounded(
      `${DETAIL_URL}?${new URLSearchParams({ mailNos: trackingNumber, lang: 'en-US' })}`,
      { headers: { ...BASE_HEADERS, Referer: 'https://www.aliexpress.com/' } },
      { provider: UPSTREAM, timeoutMs: this.timeoutMs, fetcher: this.fetcher },
    );
    return parseCainiaoTrackingResponse(parseJsonBytes(bytes, UPSTREAM), trackingNumber);
  }
}

/** Kept for the host's legacy dispatch chain until it is deleted. */
export async function fetchCainiao(trackingNumber: string): Promise<CarrierResult> {
  return new CainiaoTracker().fetch(trackingNumber);
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new CainiaoTracker({ fetcher: environment.fetcher });
  return {
    id: 'aliexpress',
    // One keyless GET; there is no second tier to fall back to.
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
