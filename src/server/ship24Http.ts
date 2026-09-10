import 'server-only';

import { createHash, createHmac } from 'node:crypto';
import { fetchBounded, parseJsonBytes } from './boundedFetch';

const PAGE = 'https://www.ship24.com/tracking';
// Public website checksum configuration, not a provisioned API credential.
// Source (verified 2026-09-10):
// https://cdn.ship24.com/assets/main.16f5bc7c0914804e.js
// getOneParcel's N(...) argument and the first value appended to $zoho_.
const WEBSITE_SIGNING_KEY = "qxV6SOr2tqw9m36j0-R-ohPt1PAB2et0"; // gitleaks:allow -- public frontend checksum constant, not an API credential
const WEBSITE_SALT = '\u1780';

// Standard MurmurHash3 x86/32, used by the public frontend's request checksum.
export function ship24Checksum(text: string): number {
  const bytes = Buffer.from(text);
  let hash = 0;
  let offset = 0;
  const mix = (value: number) => {
    value = Math.imul(value, 0xcc9e2d51);
    value = value << 15 | value >>> 17;
    return Math.imul(value, 0x1b873593);
  };
  for (; offset + 4 <= bytes.length; offset += 4) {
    hash ^= mix(bytes.readUInt32LE(offset));
    hash = hash << 13 | hash >>> 19;
    hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
  }
  let tail = 0;
  for (let index = offset; index < bytes.length; index++) tail |= bytes[index] << ((index - offset) * 8);
  if (offset < bytes.length) hash ^= mix(tail);
  hash ^= bytes.length;
  hash = Math.imul(hash ^ hash >>> 16, 0x85ebca6b);
  hash = Math.imul(hash ^ hash >>> 13, 0xc2b2ae35);
  return (hash ^ hash >>> 16) >>> 0;
}

function token(number: string): string {
  const timestamp = Date.now();
  // The anonymous endpoint accepts an opaque digest; a browser fingerprint is
  // unnecessary. Verified with fresh Node-only requests in the production container.
  const digest = createHash('sha256').update(`delivery-tracker|en-US|${timestamp}`).digest('hex');
  const encoded = Buffer.from(JSON.stringify({
    a: ship24Checksum(number + timestamp + digest.length + WEBSITE_SALT), b: timestamp, c: digest,
  })).toString('base64');
  return `${encoded}.${createHmac('sha256', WEBSITE_SIGNING_KEY).update(encoded).digest('hex')}`;
}

export class Ship24HttpClient {
  constructor(readonly fetcher?: typeof fetch) {}

  async fetch(number: string, timeoutMs: number): Promise<unknown> {
    if (!/^(?=.*\d)[A-Z0-9]{4,40}$/.test(number)) throw new TypeError('Invalid Ship24 tracking number');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError('Ship24 HTTP timeout must be positive');
    const { bytes } = await fetchBounded(`https://api.ship24.com/api/parcels/${number}?lang=en`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://www.ship24.com',
        Referer: PAGE, 'x-ship24-token': token(number) },
      body: JSON.stringify({ userAgent: '', os: 'Linux', browser: 'Unknown', device: 'Unknown',
        os_version: 'unknown', browser_version: 'unknown', deviceType: 'desktop',
        orientation: 'landscape', uL: 'en-US' }),
    }, { provider: 'Ship24 HTTP', fetcher: this.fetcher, timeoutMs: Math.floor(timeoutMs), maxBytes: 2_000_000 });
    return parseJsonBytes(bytes, 'Ship24');
  }
}

export const ship24Http = new Ship24HttpClient();
