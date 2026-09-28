import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyPostnordStatus, isPostnordAdministrativeEvent } from './status';

export function normalizePostnordNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^\d{10,20}$/.test(number) && !/^\d{11}SE$/.test(number) && !isValidS10TrackingNumber(number)) {
    throw new TypeError('PostNord requires a numeric or postal tracking number');
  }
  return number;
}

export function parsePostnord(payload: unknown, number: string): CarrierResult {
  const requested = normalizePostnordNumber(number);
  if (!isRecord(payload) || payload.shipmentId !== requested || payload.actualReturnedId !== requested
    || !Array.isArray(payload.items) || payload.items.length > 100 || !payload.items.every(isRecord)) {
    throw new SchemaError('PostNord', 'PostNord returned a different shipment or an unsupported shipment reference');
  }
  const matches = payload.items.filter((item) => item.itemId === requested);
  if (matches.length !== 1) throw new SchemaError('PostNord', 'PostNord did not return one matching item');
  const item = matches[0]!;
  if (!isRecord(item.status) || !clean(item.status.code, 64) || !Array.isArray(item.events) || item.events.length > 500) {
    throw new SchemaError('PostNord');
  }
  const scans: { event: CarrierEvent; timestamp: number }[] = [];
  const seen = new Set<string>();
  for (const raw of item.events) {
    if (!isRecord(raw)) throw new SchemaError('PostNord', 'PostNord returned an incomplete scan row');
    const description = clean(raw.eventDescription, 500);
    const code = clean(raw.status, 64);
    const rawTime = clean(raw.eventTime, 64);
    const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.test(rawTime)
      ? explicitOffsetTime(rawTime) : null;
    if (!description || !code || !time) throw new SchemaError('PostNord', 'PostNord returned a scan without valid wording, code or offset timestamp');
    // These confirmed notices describe messages or recipient choices rather
    // than parcel movement. A notification "delivered" is not a delivery scan.
    if (isPostnordAdministrativeEvent(code, description)) continue;
    const location = isRecord(raw.location) ? clean(raw.location.name, 160) : '';
    const key = `${time.timestamp}\u0000${code}\u0000${description}\u0000${location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mapped = classifyPostnordStatus(code, description);
    scans.push({ timestamp: time.timestamp, event: { time: time.iso, description, provider_code: code,
      ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) } });
  }
  if (!scans.length) throw new IndeterminateError('PostNord', 'PostNord returned no shipment history');
  // The endpoint's ascending history is displayed newest first by the widget.
  // Compare instants rather than ISO text so mixed offsets stay in order.
  scans.sort((a, b) => b.timestamp - a.timestamp);
  const events = scans.map((scan) => scan.event);
  const header = clean(item.status.header, 500);
  const mapped = classifyPostnordStatus(clean(item.status.code, 64), header);
  const measurements = Array.isArray(item.measurements) ? item.measurements.filter(isRecord) : [];
  const measured = (name: string, units: string[]) => {
    const values = measurements.filter((measurement) => measurement.name === name && typeof measurement.value === 'number'
      && Number.isFinite(measurement.value) && measurement.value > 0 && units.includes(clean(measurement.unit, 16)));
    return values.length === 1 ? values[0]! : null;
  };
  const weight = measured('weight', ['kg', 'g']);
  const dimensions = ['length', 'width', 'height'].map((name) => measured(name, ['cm']));
  const delivery = mapped?.status === 'delivered' ? events.find((event) => event.stage === 'delivered') : undefined;
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: header || events[0]!.description, last_update: events[0]!.time,
    expected_delivery: null, ...(delivery?.time ? { delivered_at: delivery.time } : {}),
    ...(weight ? { weight_kg: (weight.value as number) / (weight.unit === 'g' ? 1000 : 1) } : {}),
    ...(dimensions.every(Boolean) ? { dimensions_text: `${dimensions.map((dimension) => dimension!.value).join(' × ')} cm` } : {}),
    events: events.slice(0, 100) };
}
