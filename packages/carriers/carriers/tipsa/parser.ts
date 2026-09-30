import { load } from 'cheerio';
import { ChallengeError, IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { zonedTime } from '../../core/time';
import { clean } from '../../core/transport';
import { tipsaStatus } from './status';

const PROVIDER = 'TIPSA';
const DETAIL_ORIGIN = 'https://dinapaqweb.tipsa-dinapaq.com';
const DETAIL_PATH = '/dinapaqweb/detalle_envio.php';
const SERVICE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const MAX_ROWS = 500;
export const TIPSA_ZONE = 'Europe/Madrid';

/** The 22-digit reference: charge agency, origin agency and waybill, six, six and ten digits. */
export function normalizeTipsaNumber(raw: string): string {
  if (raw.length > 64) throw new TypeError('TIPSA tracking number is too long');
  const number = raw.replace(/[\s.-]/g, '');
  if (/^\d{22}$/.test(number)) return number;
  throw new TypeError('TIPSA requires the full 22-digit reference');
}

/**
 * The shipment page the lookup's meta refresh names, or null when TIPSA knows
 * no shipment by that reference (it then names the page with empty
 * parameters). Only TIPSA's own detail page with a service id and a
 * `dd/MM/yy` date is followed.
 */
export function tipsaDetailUrl(html: string): string | null {
  const target = /<meta\s+http-equiv=["']refresh["']\s+content=["']\s*0\s*;\s*URL=([^"'\s]{1,512})["']/i.exec(html)?.[1];
  if (!target) throw new SchemaError(PROVIDER, 'TIPSA lookup did not name a shipment page');
  let url: URL;
  try { url = new URL(target.replaceAll('&amp;', '&')); } catch { throw new SchemaError(PROVIDER, 'TIPSA shipment page address is invalid'); }
  const keys = [...url.searchParams.keys()];
  if (url.origin !== DETAIL_ORIGIN || url.pathname.toLowerCase() !== DETAIL_PATH || url.username || url.password || url.hash
    || keys.length !== 2 || !keys.includes('servicio') || !keys.includes('fecha')) {
    throw new SchemaError(PROVIDER, 'TIPSA shipment page address changed');
  }
  const service = url.searchParams.get('servicio')!;
  const date = url.searchParams.get('fecha')!;
  if (!service && !date) return null;
  if (!SERVICE.test(service) || !/^\d{2}\/\d{2}\/\d{2}$/.test(date)) {
    throw new SchemaError(PROVIDER, 'TIPSA shipment page address changed');
  }
  return url.toString();
}

/**
 * The history table of TIPSA's shipment page. Its clock is Madrid's for every
 * agency, Portuguese ones included. Recipient, sender, reference and proof of
 * delivery blocks are never read.
 */
export function parseTipsaDetail(html: string, raw: string): CarrierResult {
  const number = normalizeTipsaNumber(raw);
  if (/<title>\s*Just a moment|cf-chl-|challenge-platform|Attention Required! \| Cloudflare/i.test(html)) {
    throw new ChallengeError(PROVIDER, 'TIPSA returned a browser challenge');
  }
  const $ = load(html);
  const value = (selector: string) => clean($(selector).attr('value'), 32);
  const parts = value('#CodAgeCargo') + value('#CodAgeOri') + value('#Albaran');
  if (value('#envio-localizado') !== number || parts !== number) {
    throw new SchemaError(PROVIDER, 'TIPSA page does not identify the requested shipment');
  }
  const tables = $('table').filter((_, table) => $(table).find('thead th').map((__, th) => clean($(th).text(), 32)).get()
    .join('|') === 'FECHA/HORA|ESTADO|POBLACIÓN');
  if (tables.length !== 1) throw new SchemaError(PROVIDER, 'TIPSA shipment history is missing');
  const rows = tables.find('tbody > tr');
  if (rows.length > MAX_ROWS) throw new SchemaError(PROVIDER, 'TIPSA returned too many history rows');

  const events: (CarrierEvent & { time: string })[] = [];
  const seen = new Set<string>();
  rows.each((_, row) => {
    const cells = $(row).children('td');
    if (cells.length !== 3) throw new SchemaError(PROVIDER, 'TIPSA history row changed');
    // Each cell repeats its text in a tooltip span, which is skipped.
    const cellText = (index: number) => {
      const cell = cells.eq(index);
      const spans = cell.children('span').not('.mdl-tooltip');
      return clean((spans.length ? spans : cell).first().text(), 160);
    };
    const time = zonedTime(cellText(0), 'dd/MM/yy HH:mm', TIPSA_ZONE);
    const description = cellText(1);
    if (!time || !description) throw new SchemaError(PROVIDER, 'TIPSA history row has no time or status');
    const location = cellText(2);
    const key = JSON.stringify([time.iso, description, location]);
    if (seen.has(key)) return;
    seen.add(key);
    const stage = tipsaStatus(description)?.stage;
    events.push({ time: time.iso, description, ...(location ? { location } : {}), ...(stage ? { stage } : {}) });
  });
  if (!events.length) throw new IndeterminateError(PROVIDER, 'TIPSA shipment history is empty');
  // Newest first, as the page lists them; rows of one minute keep the page's order.
  events.sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
  const newest = events[0]!;
  const current = tipsaStatus(newest.description!);
  return {
    status: current?.status ?? 'unknown',
    ...(current ? { current_stage: current.stage } : {}),
    last_status_text: newest.description,
    last_update: newest.time,
    expected_delivery: null,
    timezone: TIPSA_ZONE,
    events,
  };
}
