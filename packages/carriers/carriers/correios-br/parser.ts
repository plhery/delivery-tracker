import { DateTime, IANAZone } from 'luxon';
import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { ChallengeError, IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyCorreiosStatus } from './status';

export function normalizeCorreiosNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(number) || !isValidS10TrackingNumber(number)) {
    throw new TypeError('Correios requires a valid postal S10 tracking number');
  }
  return number;
}

export function isCorreiosCaptchaError(payload: unknown): boolean {
  return isRecord(payload) && (payload.erro === true || payload.erro === 'true')
    && clean(payload.mensagem, 100).toLowerCase() === 'captcha inválido';
}

function scanClock(value: unknown): Pick<CarrierEvent, 'time'> & { local_time?: string; provider_time_text?: string } {
  const raw = clean(isRecord(value) ? value.date : value, 64);
  const digits = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.\d{1,6})?$/.exec(raw)?.[1];
  const wall = digits ? DateTime.fromFormat(digits, 'yyyy-MM-dd HH:mm:ss', { zone: 'UTC' }) : null;
  if (!wall?.isValid) return raw ? { provider_time_text: raw } : {};
  const local = wall.toISO({ includeOffset: false, suppressMilliseconds: true })!;
  const zone = isRecord(value) && value.timezone_type === 3 ? clean(value.timezone, 64) : '';
  if (!zone || !IANAZone.isValidZone(zone)) return { local_time: local };
  // Use the explicit per-row zone only when its clock exists uniquely. Do not
  // silently shift a nonexistent DST clock or choose between repeated clocks.
  const zoned = DateTime.fromFormat(digits!, 'yyyy-MM-dd HH:mm:ss', { zone });
  if (!zoned.isValid || zoned.toFormat('yyyy-MM-dd HH:mm:ss') !== digits || zoned.getPossibleOffsets().length !== 1) {
    return { local_time: local };
  }
  return { time: zoned.toISO({ suppressMilliseconds: true })! };
}

export function parseCorreios(payload: unknown, number: string): CarrierResult {
  const requested = normalizeCorreiosNumber(number);
  if (!isRecord(payload)) throw new SchemaError('Correios');
  if (isCorreiosCaptchaError(payload)) throw new ChallengeError('Correios', 'Correios rejected the text CAPTCHA');
  // Period errors and other unbound error replies prove neither absence nor identity.
  if (payload.erro === true || payload.erro === 'true') throw new IndeterminateError('Correios', 'Correios returned an inconclusive tracking response');
  if (payload.codObjeto !== requested) throw new SchemaError('Correios', 'Correios returned a different tracking object');
  if (!Array.isArray(payload.eventos) || payload.eventos.length > 500) throw new SchemaError('Correios');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const row of payload.eventos) {
    if (!isRecord(row)) throw new SchemaError('Correios', 'Correios returned an incomplete scan');
    const code = clean(row.codigo, 8);
    const subtype = clean(row.tipo, 8);
    const description = clean(row.descricao, 500);
    if (!/^[A-Z]{2,4}$/.test(code) || !/^\d{2}$/.test(subtype) || !description) throw new SchemaError('Correios', 'Correios returned an incomplete scan');
    const providerCode = `${code}/${subtype}`;
    const clock = scanClock(row.dtHrCriado);
    const address = isRecord(row.unidade) && isRecord(row.unidade.endereco) ? row.unidade.endereco : null;
    const location = address ? [clean(address.cidade, 100), clean(address.uf, 8)].filter(Boolean).join(', ') : '';
    const key = `${clock.time ?? clock.local_time ?? clock.provider_time_text ?? ''}\u0000${providerCode}\u0000${description}\u0000${location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mapped = classifyCorreiosStatus(providerCode);
    events.push({ description, provider_code: providerCode, ...clock, ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) });
  }
  if (!events.length) throw new IndeterminateError('Correios', 'Correios returned no tracking scans');
  // The single-object response is newest first. Keep unresolved clocks there.
  const latest = events[0]!;
  const mapped = classifyCorreiosStatus(latest.provider_code ?? '');
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, last_update_local: latest.local_time ?? null,
    expected_delivery: null, ...(mapped?.status === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    events: events.slice(0, 100) };
}
