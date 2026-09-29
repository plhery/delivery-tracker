import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean } from '../../core/transport';
import { calendarDay, zonedTime } from '../../core/time';
import { classifyCiblexStatus, comparableText } from './status';

export function normalizeCiblexTrackingNumber(raw: string): string {
  const number = raw.replace(/\s/g, '');
  if (!/^(?:\d{14}|\d{24})$/.test(number)) throw new TypeError('Ciblex requires exactly 14 or 24 digits');
  return number;
}

export function ciblexTrackingUrl(raw: string): string {
  const url = new URL('https://secure.extranet.ciblex.fr/extranet/client/corps.php');
  url.search = new URLSearchParams({ module: 'colis', colis: normalizeCiblexTrackingNumber(raw) }).toString();
  return url.toString();
}

function scanTime(date: string, clock: string): { time?: string; local_time?: string; provider_time_text?: string } {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  const day = match && calendarDay(Number(match[3]), Number(match[2]), Number(match[1]));
  if (day && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clock)) {
    const local = `${day}T${clock.length === 5 ? `${clock}:00` : clock}`;
    const parsed = zonedTime(`${date} ${clock}`, clock.length === 8 ? 'dd/MM/yyyy HH:mm:ss' : 'dd/MM/yyyy HH:mm', 'Europe/Paris');
    const unique = DateTime.fromISO(local, { zone: 'Europe/Paris' }).getPossibleOffsets().length === 1;
    if (parsed?.iso.startsWith(local) && unique) return { time: parsed.iso };
    return { local_time: local };
  }
  const text = clean(`${date} ${clock}`, 64);
  return text ? { provider_time_text: text } : {};
}

function safeLocation(raw: string): string {
  const value = clean(raw, 100);
  // Free-form places can contain the recipient address. Retain only the
  // established operational-depot label with a repeated department code.
  return /^([\p{Letter}\p{Mark} .'\/-]{1,70}) (\d{2,3}) \(\2\)$/u.test(value) ? value : '';
}

export function parseCiblexTrackingHtml(html: string, raw: string): CarrierResult {
  const number = normalizeCiblexTrackingNumber(raw);
  if (!html.trim()) throw new IndeterminateError('Ciblex', 'Ciblex returned an empty tracking response');
  const $ = load(html);
  $('script, style, noscript').remove();
  const banners = $('.t_bandeau_detail td').toArray().map(node => clean($(node).text(), 500))
    .filter(text => /SUIVI\s+COLIS/i.test(text));
  if (!banners.length && $('.f_erreur').length) throw new IndeterminateError('Ciblex', 'Ciblex did not return bound parcel information');
  if (banners.length !== 1) throw new SchemaError('Ciblex', 'Ciblex did not return one shipment identifier');
  // The native banner can append a shorter numeric annotation and merchant
  // reference in parentheses. Neither is an identity alias or projected data.
  const identity = /^SUIVI\s+COLIS\s*:\s*(\d{14}|\d{24})(?:\s*\([^()\r\n]{1,160}\))*$/i.exec(banners[0]!);
  if (!identity || identity[1] !== number) throw new SchemaError('Ciblex', 'Ciblex returned a different shipment');
  const tables = $('table[border="2"]');
  if (tables.length !== 1) throw new SchemaError('Ciblex', 'Ciblex returned ambiguous tracking history');
  const rows = tables.find('tr');
  if (rows.length > 501) throw new SchemaError('Ciblex', 'Ciblex returned excessive tracking history');
  const header = rows.first().children('td, th').map((_, node) => comparableText($(node).text())).get();
  if (header.join('|') !== 'date|heure livraison|action|lieu') throw new SchemaError('Ciblex', 'Ciblex tracking columns changed');
  if (rows.length === 1) throw new IndeterminateError('Ciblex', 'Ciblex returned no parcel history');
  const scanned: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(1).toArray()) {
    const cells = $(row).children('td');
    if (cells.length !== 4) throw new SchemaError('Ciblex', 'Ciblex returned an incomplete scan');
    const date = clean(cells.eq(0).text(), 32);
    const clock = clean(cells.eq(1).text(), 24);
    const rawLabel = cells.eq(2).text();
    if (!rawLabel.trim() || rawLabel.length > 200) throw new SchemaError('Ciblex', 'Ciblex returned an invalid scan');
    const label = clean(rawLabel, 200);
    // Deduplicate native scans before suppressing private places; distinct
    // native sites must not collapse just because neither can be projected.
    const key = JSON.stringify([date, clock, label, clean(cells.eq(3).text(), 200)]);
    if (seen.has(key)) continue;
    seen.add(key);
    const mapped = classifyCiblexStatus(label);
    const location = mapped.status === 'exception' ? '' : safeLocation(cells.eq(3).text());
    scanned.push({ ...scanTime(date, clock), description: mapped.description, provider_status: label, location,
      ...(mapped.status !== 'unknown' ? { stage: mapped.stage } : {}) });
  }
  // Native position is authoritative when any clock is unresolved. Fully
  // dated histories can be ordered by instant with stable equal-time ties.
  if (scanned.every(event => event.time)) scanned.sort((a, b) => Date.parse(b.time!) - Date.parse(a.time!));
  const events = scanned;
  const latest = events[0]!;
  const mapped = classifyCiblexStatus(String(latest.provider_status));
  return { status: mapped.status, ...(mapped.status !== 'unknown' ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, expected_delivery: null,
    ...(latest.local_time ? { last_update_local: latest.local_time } : {}),
    timezone: 'Europe/Paris', events: events.slice(0, 100) };
}
