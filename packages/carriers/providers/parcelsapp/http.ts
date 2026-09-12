import 'server-only';

import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { numberOf } from '../shared/result';

export const PARCELSAPP_API = 'https://parcelsapp.com/api/v2/parcels';

// Public frontend protocol, verified 2026-09-12. No session or issued secret:
// packs/js/application-aa19cda6a00923f7e330.js on dvow0vltefbxy.cloudfront.net.
// The website accepts this fixed telemetry profile, including its documented
// "undefined" stack fallback. The checksum below binds it to each number.
const TELEMETRY = '1361x780,1470x830,1280x800,no,MacIntel,Gecko,Mozilla,Netscape,Google Inc.,true,true,'
  + 'Google Inc. (Apple),ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version),true,true,'
  + Buffer.from('parcelsapp.com').toString('base64') + ',' + Buffer.from('undefined').toString('base64');

/** MurmurHash2 with the public website's seed, over ASCII protocol data. */
export function parcelsAppChecksum(text: string): number {
  const bytes = Buffer.from(text, 'ascii');
  let hash = 978 ^ bytes.length;
  let offset = 0;
  for (; offset + 4 <= bytes.length; offset += 4) {
    let block = Math.imul(bytes.readUInt32LE(offset), 0x5bd1e995);
    block ^= block >>> 24;
    hash = Math.imul(hash, 0x5bd1e995) ^ Math.imul(block, 0x5bd1e995);
  }
  const remaining = bytes.length - offset;
  if (remaining >= 3) hash ^= bytes[offset + 2] << 16;
  if (remaining >= 2) hash ^= bytes[offset + 1] << 8;
  if (remaining >= 1) hash = Math.imul(hash ^ bytes[offset], 0x5bd1e995);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  return (hash ^ hash >>> 15) >>> 0;
}

export function parcelsAppRequest(trackingNumber: string, postcode?: string | null): URLSearchParams {
  const number = numberOf(trackingNumber);
  // The bundle shifts ASCII by 2 * sum([1,2,8,4,5,6,7,5]) modulo 126,
  // URI-encodes it, then lets jQuery form-encode it a second time.
  const shifted = [...number].map((char) => String.fromCharCode((char.charCodeAt(0) + 76) % 126)).join('');
  const params = new URLSearchParams({
    trackingId: encodeURIComponent(shifted), carrier: 'Auto-Detect', language: 'en', country: 'Unknown',
    platform: 'web-desktop', wd: 'false', c: 'true', p: '5', l: '3',
    se: `${TELEMETRY},${TELEMETRY.length},${number.length},${parcelsAppChecksum(encodeURIComponent(number) + TELEMETRY)}`,
  });
  const zipcode = postcode?.trim();
  if (zipcode) params.set('extra[zipcode]', zipcode);
  return params;
}

export class ParcelsAppHttpClient {
  constructor(readonly fetcher?: typeof fetch) {}

  async fetch(trackingNumber: string, timeoutMs: number, postcode?: string | null): Promise<unknown> {
    const number = numberOf(trackingNumber);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError('ParcelsApp HTTP timeout must be positive');
    const { bytes } = await fetchBounded(PARCELSAPP_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: 'https://parcelsapp.com', Referer: `https://parcelsapp.com/en/tracking/${number}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: parcelsAppRequest(number, postcode),
    }, { provider: 'ParcelsApp', fetcher: this.fetcher, timeoutMs: Math.floor(timeoutMs), maxBytes: 2_000_000 });
    return parseJsonBytes(bytes, 'ParcelsApp');
  }
}
