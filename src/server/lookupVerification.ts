import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { clientIp, clientNetwork, HttpError } from './api';
import { logOperationalEvent } from './observability';
import { requestHostname } from './siteHosts';

const PROOF_SECONDS = 15 * 60;
const ACTION = 'parcel_lookup';

export function turnstileSettings(env: Record<string, string | undefined> = process.env) {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  const hostnames = (env.TURNSTILE_HOSTNAMES ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!siteKey && !secret && !hostnames.length) return null;
  if (!siteKey || !secret || !hostnames.length || hostnames.some((host) => !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(host))) {
    throw new Error('TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY and TURNSTILE_HOSTNAMES must be configured together');
  }
  if (env.NODE_ENV === 'production' && (siteKey.startsWith('1x000000') || siteKey.startsWith('2x000000') || siteKey.startsWith('3x000000'))) {
    throw new Error('Turnstile test keys must not be used in production');
  }
  return { siteKey, secret, hostnames };
}

function binding(request: Request): string {
  return `${requestHostname(request.headers) ?? new URL(request.url).hostname}\n${clientNetwork(clientIp(request))}`;
}

function signature(secret: string, payload: string, request: Request): Buffer {
  return createHmac('sha256', secret).update(`lookup-proof-v1\n${payload}\n${binding(request)}`).digest();
}

/** A short-lived proof never replaces the IP, network or global lookup budgets. */
export function requireLookupProof(request: Request): void {
  const settings = turnstileSettings();
  if (!settings) return;
  const proof = request.headers.get('x-lookup-proof') ?? '';
  const match = /^(\d{10})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(proof);
  if (match) {
    const expires = Number(match[1]);
    const now = Math.floor(Date.now() / 1_000);
    const received = Buffer.from(match[3]!, 'base64url');
    const expected = signature(settings.secret, `${match[1]}.${match[2]}`, request);
    if (expires > now && expires <= now + PROOF_SECONDS && received.length === expected.length && timingSafeEqual(received, expected)) return;
  }
  throw new HttpError(403, 'Please verify your browser and try again.', { 'X-Lookup-Verification': 'required' });
}

/** Only the single-use Cloudflare token is exchanged; parcel inputs never go to Siteverify. */
export async function verifyLookupBrowser(request: Request, token: unknown): Promise<{ proof: string; expiresAt: number }> {
  const settings = turnstileSettings();
  if (!settings) throw new HttpError(503, 'Browser verification is not configured');
  if (typeof token !== 'string' || !token || token.length > 2_048) throw new HttpError(400, 'Invalid verification token');
  const hostname = requestHostname(request.headers) ?? new URL(request.url).hostname;
  if (!settings.hostnames.includes(hostname)) throw new HttpError(403, 'Browser verification is unavailable on this hostname');
  const started = performance.now();
  let outcome = 'unavailable';
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: settings.secret, response: token }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error('Verification service unavailable');
    const result: unknown = await response.json();
    const verified = result as { success?: unknown; hostname?: unknown; action?: unknown } | null;
    if (!verified || verified.success !== true || verified.hostname !== hostname || verified.action !== ACTION) {
      outcome = 'rejected';
      throw new HttpError(403, 'Please verify your browser and try again.');
    }
    outcome = 'verified';
    const expires = Math.floor(Date.now() / 1_000) + PROOF_SECONDS;
    const payload = `${expires}.${randomBytes(16).toString('base64url')}`;
    return { proof: `${payload}.${signature(settings.secret, payload, request).toString('base64url')}`, expiresAt: expires * 1_000 };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Never attach upstream request diagnostics, which could contain the secret or token.
    throw new HttpError(503, 'Browser verification is temporarily unavailable. Try again shortly.', { 'Retry-After': '5' });
  } finally {
    logOperationalEvent('lookup_verification', { outcome, duration_ms: Math.round(performance.now() - started) });
  }
}
