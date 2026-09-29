import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { calendarDay, explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifySeurStatus } from './status';

export function normalizeSeurNumber(raw: string): string {
  const number = raw.replace(/\s/g, '');
  if (!/^(?:\d{7}|\d{14}|\d{21})$/.test(number)) throw new TypeError('SEUR requires a seven, fourteen or twenty-one digit identifier');
  return number;
}

function field(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new SchemaError('SEUR', 'SEUR returned an invalid scan field');
  return clean(value, limit);
}

function scanTime(value: unknown): { time?: string; local_time?: string; provider_time_text?: string } {
  if (value == null || value === '') return {};
  const raw = field(value, 64);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):?(\d{2}))?$/i.exec(raw);
  if (match && calendarDay(Number(match[1]), Number(match[2]), Number(match[3]))
    && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) < 60
    && (!match[8] || (Number(match[8]) < 24 && Number(match[9]) < 60))) {
    if (!match[7]) return { local_time: raw };
    const parsed = explicitOffsetTime(raw);
    if (parsed) return { time: parsed.iso };
  }
  return raw ? { provider_time_text: raw } : {};
}

export function parseSeur(value: unknown, raw: string): CarrierResult {
  const number = normalizeSeurNumber(raw);
  if (!isRecord(value) || !Object.hasOwn(value, 'codigo_error')) throw new SchemaError('SEUR', 'SEUR tracking response changed');
  // The same lookup error covers absent, recent and out-of-range histories.
  // It does not establish that the requested parcel never existed.
  if (value.codigo_error != null) throw new IndeterminateError('SEUR', 'SEUR did not locate usable shipment history');
  if (value.identificador_busqueda !== number || typeof value.clave_envio !== 'string'
    || !value.clave_envio || value.clave_envio.length > 80) throw new SchemaError('SEUR', 'SEUR returned a different or incomplete shipment');
  if (!Array.isArray(value.situaciones)) throw new SchemaError('SEUR', 'SEUR tracking scans changed');
  if (!value.situaciones.length) throw new IndeterminateError('SEUR', 'SEUR returned empty shipment history');
  if (value.situaciones.length > 500) throw new SchemaError('SEUR', 'SEUR returned too many tracking scans');
  if (value.num_bultos !== 1) throw new IndeterminateError('SEUR', 'SEUR single-piece shipment history is required');
  if (value.bultos != null && (!Array.isArray(value.bultos) || value.bultos.length > 1
    || value.bultos.some(piece => !isRecord(piece)))) {
    throw new IndeterminateError('SEUR', 'SEUR returned ambiguous parcel details');
  }
  const events: CarrierEvent[] = value.situaciones.map(row => {
    if (!isRecord(row)) throw new SchemaError('SEUR', 'SEUR returned an invalid scan');
    const code = field(row.cod_situacion, 12);
    const group = field(row.grupo_situacion, 80);
    const label = field(row.descripcion_situacion, 500);
    if (!/^[A-Z0-9]{2,12}$/.test(code) || !group || !label) throw new SchemaError('SEUR', 'SEUR returned an incomplete scan');
    const mapped = classifySeurStatus(code, group, label);
    return { description: mapped?.status === 'delivered' ? 'Delivered' : label, provider_status: label,
      provider_group: group, provider_code: code, ...(mapped ? { stage: mapped.stage } : {}), ...scanTime(row.fecha) };
  });
  // The official widget consumes situaciones[0]; unresolved clocks retain that position.
  const latest = events[0]!;
  const mapped = classifySeurStatus(latest.provider_code!, String(latest.provider_group), String(latest.provider_status));
  const weight = value.peso;
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null,
    ...(latest.local_time ? { last_update_local: latest.local_time } : {}),
    ...(mapped?.status === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    ...(typeof weight === 'number' && Number.isFinite(weight) && weight > 0 && weight <= 100_000 ? { weight_kg: weight } : {}),
    events: events.slice(0, 100) };
}
