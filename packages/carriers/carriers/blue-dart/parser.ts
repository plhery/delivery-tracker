import { load } from 'cheerio';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { zonedTime } from '../../core/time';
import { clean } from '../../core/transport';
import { classifyBlueDartStatus } from './status';

export function normalizeBlueDartNumber(raw: string): string {
  const number = raw.replace(/[\s.-]/g, '');
  if (!/^\d{11}$/.test(number)) throw new TypeError('Blue Dart requires an eleven-digit waybill');
  return number;
}

export function parseBlueDart(html: string, number: string): CarrierResult {
  const requested = normalizeBlueDartNumber(number);
  const $ = load(html);
  const summaries = $('table').filter((_, table) => $(table).find('th').toArray().some(th => clean($(th).text(), 100) === 'Waybill No'));
  if (!summaries.length) {
    const activatesReasons = $('script:not([src])').toArray().some(e => /\$\(\s*(['"])#reasons\1\s*\)\s*\.show\(\s*\)/.test($(e).text()));
    if (activatesReasons && $('#reasons h4').toArray().some(e => clean($(e).text(), 300).startsWith('There is no information on the Waybill/Reference Number/Order Number currently.'))) {
      throw new NotFoundError('Blue Dart');
    }
    throw new SchemaError('Blue Dart', 'Blue Dart returned no shipment summary');
  }
  if (summaries.length !== 1) throw new SchemaError('Blue Dart', 'Blue Dart returned ambiguous shipments');
  const fields = new Map<string, string>();
  summaries.find('tr').each((_, row) => {
    fields.set(clean($(row).find('th').first().text(), 100), clean($(row).find('td').first().text(), 500));
  });
  if (fields.get('Waybill No') !== requested) throw new SchemaError('Blue Dart', 'Blue Dart returned a different shipment');
  const histories = $('table').filter((_, table) => $(table).find('th').toArray().some(th => clean($(th).text(), 100) === 'Status and Scans'));
  if (histories.length !== 1) throw new SchemaError('Blue Dart', 'Blue Dart returned invalid scan tables');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  histories.find('tr').slice(0, 500).each((_, row) => {
    const cells = $(row).children('td');
    if (cells.length !== 4) return;
    const location = clean(cells.eq(0).text(), 160);
    const description = clean(cells.eq(1).text(), 500);
    if (!description) return;
    const date = clean(cells.eq(2).text(), 64);
    const local = `${date} ${clean(cells.eq(3).text(), 32)}`;
    const time = zonedTime(local, 'dd MMM yyyy HH:mm', 'Asia/Kolkata', { locale: 'en' });
    const key = `${time?.iso ?? local}\u0000${description}\u0000${location}`;
    if (seen.has(key)) return;
    seen.add(key);
    const mapped = classifyBlueDartStatus(description);
    events.push({ description, ...(location ? { location } : {}), ...(time ? { time: time.iso } : date ? { provider_time_text: date } : {}),
      ...(mapped ? { stage: mapped.stage } : {}) });
  });
  if (!events.length) throw new IndeterminateError('Blue Dart', 'Blue Dart returned no scan history');
  // The portal lists newest first; unresolved dates cannot reorder that evidence.
  const latest = events[0]!;
  const summary = fields.get('Status') ?? '';
  const mapped = classifyBlueDartStatus(summary);
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: summary || latest.description, last_update: latest.time ?? null, timezone: 'Asia/Kolkata',
    ...(mapped?.status === 'delivered' && latest.stage === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    expected_delivery: null, events: events.slice(0, 100) };
}
