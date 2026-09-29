import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { ChallengeError, IndeterminateError, RateLimitedError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { calendarDay } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyCorreosChileScan } from './status';

const ORIGIN = 'https://www.correos.cl';
const PORTLET = /^cl_cch_seguimiento_portlet_seguimientoenlineaportlet_INSTANCE_[A-Za-z0-9]{8,24}$/;
const RESOURCE = 'cl_cch_seguimiento_portlet_seguimientoresurcecommand';
const ALLOWED_PARAMS = new Set(['p_p_id', 'p_p_lifecycle', 'p_p_state', 'p_p_mode', 'p_p_resource_id', 'p_p_cacheability']);

export function normalizeCorreosChileNumber(raw: string): string {
  if (raw.length > 48) throw new TypeError('Correos de Chile tracking number is too long');
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (/^\d{13}$/.test(number) || (/^[A-Z]{2}\d{9}CL$/.test(number) && isValidS10TrackingNumber(number))) return number;
  throw new TypeError('Correos de Chile requires 13 digits or a valid Chilean postal number');
}

export interface ChileBootstrap {
  url: string;
  numberField: string;
  csrf: string;
}

export function parseCorreosChileBootstrap(html: string): ChileBootstrap {
  if (/Radware (?:Captcha )?Page|We apologize for the inconvenience|Please solve this CAPTCHA/i.test(html)) {
    throw new ChallengeError('Correos de Chile', 'Correos de Chile returned a browser challenge');
  }
  const csrf = /Liferay\.authToken\s*=\s*'([A-Za-z0-9_-]{4,128})'/.exec(html)?.[1];
  const rawUrl = /var\s+ajaxSeguimientosURL\s*=\s*"([^"\r\n]{1,2048})"/.exec(html)?.[1];
  if (!csrf || !rawUrl) throw new SchemaError('Correos de Chile', 'Tracking session fields are missing');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new SchemaError('Correos de Chile', 'Tracking resource URL is invalid'); }
  const id = url.searchParams.get('p_p_id') ?? '';
  const namespace = `_${id}_`;
  const cmd = `${namespace}cmd`;
  if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== '/seguimiento-en-linea'
    || !PORTLET.test(id) || url.searchParams.get('p_p_lifecycle') !== '2'
    || url.searchParams.get('p_p_resource_id') !== RESOURCE
    || url.searchParams.get(cmd) !== 'cmd_resource_get_seguimientos'
    || [...url.searchParams.keys()].some(key => (!ALLOWED_PARAMS.has(key) && key !== cmd)
      || url.searchParams.getAll(key).length !== 1)) {
    throw new SchemaError('Correos de Chile', 'Tracking resource changed');
  }
  return { url: url.toString(), numberField: `${namespace}param_nro_seguimiento`, csrf };
}

function scanClock(raw: unknown, fallback: unknown): { local_time?: string; provider_time_text?: string } {
  const value = clean(raw, 64);
  const match = /^(\d{4})-(\d{2})-(\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)$/.exec(value);
  if (match && calendarDay(Number(match[1]), Number(match[2]), Number(match[3]))) return { local_time: value };
  const text = clean(value || fallback, 64);
  return text ? { provider_time_text: text } : {};
}

function operationalOffice(value: unknown): string {
  const office = clean(value, 80);
  return /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ -]{2,79}$/.test(office) ? office : '';
}

function scanDescription(value: string, mapped: ReturnType<typeof classifyCorreosChileScan>): string {
  if (mapped) return clean(value, 160);
  // Estado is an untyped provider string. Avoid projecting free-form recipient
  // or delivery details into a publicly visible history field.
  return 'Actualización del envío';
}

export function parseCorreosChileTracking(payload: unknown, raw: string): CarrierResult {
  const number = normalizeCorreosChileNumber(raw);
  if (!isRecord(payload)) throw new SchemaError('Correos de Chile', 'Tracking response is not an object');
  if (payload.error === true) {
    if (payload.maxLimit === true) throw new RateLimitedError('Correos de Chile');
    // The same reply covers an unknown reference and a previously valid
    // shipment whose history is no longer available.
    throw new IndeterminateError('Correos de Chile', 'Tracking lookup returned no usable shipment history');
  }
  if (payload.error !== false || typeof payload.seguimiento !== 'string' || payload.seguimiento.length > 250_000) {
    throw new SchemaError('Correos de Chile', 'Tracking response has no shipment detail');
  }
  let detail: unknown;
  try { detail = JSON.parse(payload.seguimiento); }
  catch { throw new SchemaError('Correos de Chile', 'Shipment detail is not JSON'); }
  if (!isRecord(detail) || detail.MainCodigo !== number || detail.Referencia !== number || !Array.isArray(detail.historial)
    || detail.historial.length > 500 || !detail.historial.every(isRecord)) {
    throw new SchemaError('Correos de Chile', 'Tracking response does not identify one requested shipment');
  }
  if (!detail.historial.length) throw new IndeterminateError('Correos de Chile', 'Shipment history is empty');

  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const row of detail.historial) {
    const rawStatus = row.Estado;
    if (typeof rawStatus !== 'string' || !rawStatus.trim() || rawStatus.length > 500) {
      throw new SchemaError('Correos de Chile', 'Shipment scan lacks a status');
    }
    const code = /^\d{1,3}$/.test(clean(row.Icono, 32)) ? clean(row.Icono, 32) : '';
    const mapped = classifyCorreosChileScan(code, rawStatus);
    const description = scanDescription(rawStatus, mapped);
    const time = scanClock(row.FechaDate, row.Fecha);
    const location = operationalOffice(row.Oficina);
    const key = JSON.stringify([row.FechaDate, row.Fecha, rawStatus, row.Icono, row.Oficina]);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ ...time, description, ...(code ? { provider_code: code } : {}),
      ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) });
  }
  // The portal renders the first history row as current and fades all later
  // rows; retain that order even when the newest row has an unresolved clock.
  const newest = events[0]!;
  const mapped = classifyCorreosChileScan(String(newest.provider_code ?? ''), newest.description ?? '');
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: newest.description, last_update: null,
    ...(newest.local_time ? { last_update_local: newest.local_time } : {}),
    expected_delivery: null, events: events.slice(0, 100) };
}
