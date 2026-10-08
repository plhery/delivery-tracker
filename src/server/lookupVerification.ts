import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { clientIp, clientNetwork, HttpError } from './api';
import { logOperationalEvent } from './observability';
import { requestHostname } from './siteHosts';
import { verifyNativeRequest } from './nativeVerification';
import type { SupabaseServiceClient } from './supabase';

const PROOF_SECONDS = 15 * 60;
const ACTION = 'parcel_lookup';
/** Networks besides its own a proof works on: a device moving between IPv4 and IPv6, or Wi-Fi and mobile data. */
const OTHER_NETWORKS = 2;
/** Proofs whose moves are remembered at once; past this the first to move is forgotten. */
const MOVED_PROOFS = 10_000;
/** Expiry, nonce, the family and network tag it was issued on, signature. */
const PROOF = /^(\d{10})\.([A-Za-z0-9_-]{22})\.([046][A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{43})$/;

type Refusal = 'missing' | 'malformed' | 'bad_signature' | 'expired' | 'too_many_networks';

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

/**
 * The network a request comes from, as a proof records it: the address family
 * (`4`, `6`, or `0` without an address), then a keyed tag of the IPv4 address
 * or IPv6 /64, so the proof never carries the address itself.
 */
function network(secret: string, request: Request): string {
  const ip = clientIp(request);
  const counted = clientNetwork(ip);
  const version = isIP(ip) === 0 ? '0' : isIP(counted) === 4 ? '4' : '6';
  return `${version}${createHmac('sha256', secret).update(`lookup-network-v1\n${counted}`).digest().subarray(0, 8).toString('base64url')}`;
}

/** The address family of a recorded network, as logs name it. */
const family = (recorded: string) => (recorded.startsWith('4') ? 'v4' : recorded.startsWith('6') ? 'v6' : 'none');

/** The proof is signed for the hostname it was issued on; its network is part of the payload. */
function signature(secret: string, payload: string, request: Request): Buffer {
  const hostname = requestHostname(request.headers) ?? new URL(request.url).hostname;
  return createHmac('sha256', secret).update(`lookup-proof-v2\n${hostname}\n${payload}`).digest();
}

interface Moves { expires: number; networks: Set<string> }

// Next can bundle the lookup and detection routes apart, each with its own copy of
// this module: the moves live on globalThis, so a proof has one count per process.
const globalMoves = globalThis as typeof globalThis & { __lookupProofMoves?: Map<string, Moves> };

/** The other networks a proof has worked on, by its nonce. Expired proofs go when another proof moves. */
function movesOf(nonce: string, expires: number, now: number): Set<string> {
  const moves = globalMoves.__lookupProofMoves ??= new Map();
  const known = moves.get(nonce);
  if (known) return known.networks;
  for (const [key, entry] of moves) if (entry.expires <= now) moves.delete(key);
  const first = moves.keys().next();
  if (moves.size >= MOVED_PROOFS && !first.done) moves.delete(first.value);
  const entry = { expires, networks: new Set<string>() };
  moves.set(nonce, entry);
  return entry.networks;
}

interface ProofCheck {
  /** `moved`: accepted on a network the proof had not worked on before. */
  outcome: 'accepted' | 'moved' | 'refused';
  reason?: Refusal;
  fields: Record<string, string | number>;
}

/**
 * A proof works on the network it was issued on and on up to two others, so a
 * device that changes address keeps it while a proof handed around stops after
 * three networks. The fields say why, never with the address or the proof.
 */
function checkProof(secret: string, request: Request): ProofCheck {
  const used = network(secret, request);
  const fields: Record<string, string | number> = {
    kind: new URL(request.url).pathname === '/api/public/parcels' ? 'lookup' : 'detection',
    used_family: family(used),
  };
  const refused = (reason: Refusal): ProofCheck => ({ outcome: 'refused', reason, fields });
  const proof = request.headers.get('x-lookup-proof');
  if (!proof) return refused('missing');
  const now = Math.floor(Date.now() / 1_000);
  const match = PROOF.exec(proof);
  // No proof is issued further ahead than its lifetime.
  if (!match || Number(match[1]) > now + PROOF_SECONDS) return refused('malformed');
  const [, expiresText = '', nonce = '', issued = '', sent = ''] = match;
  const expected = signature(secret, `${expiresText}.${nonce}.${issued}`, request);
  const received = Buffer.from(sent, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return refused('bad_signature');
  const expires = Number(expiresText);
  fields.issued_family = family(issued);
  fields.age_s = now - (expires - PROOF_SECONDS);
  if (expires <= now) return refused('expired');
  if (issued === used) return { outcome: 'accepted', fields };
  const others = movesOf(nonce, expires, now);
  if (others.has(used)) return { outcome: 'accepted', fields };
  const full = others.size >= OTHER_NETWORKS;
  if (!full) others.add(used);
  fields.networks = 1 + others.size;
  return full ? refused('too_many_networks') : { outcome: 'moved', fields };
}

/** A short-lived proof never replaces the IP, network or global lookup budgets. */
export function requireLookupProof(request: Request): void {
  const settings = turnstileSettings();
  if (!settings) return;
  // Compatibility only: callers can forge this header. All lookup budgets still apply.
  if (process.env.TURNSTILE_ALLOW_NATIVE_USER_AGENT === 'true'
    && !request.headers.has('x-native-verification')
    && /^PeekDeliveryTracker\/\S+ CFNetwork\/\S+ Darwin\/\S+$/.test(request.headers.get('user-agent') ?? '')) return;
  const { outcome, reason, fields } = checkProof(settings.secret, request);
  if (outcome === 'accepted') return;
  logOperationalEvent('lookup_proof', { outcome, reason, ...fields });
  if (outcome === 'refused') throw new HttpError(403, 'Please verify your browser and try again.', { 'X-Lookup-Verification': 'required' });
}

/** Native assertions count the installation before the shared IP and global budgets. */
export async function verifyLookupRequest(request: Request, service: SupabaseServiceClient) {
  if (!turnstileSettings()) return;
  if (['x-app-attest-key-id', 'x-app-attest-challenge', 'x-app-attest-assertion'].some((header) => request.headers.has(header))) {
    await verifyNativeRequest(request, service);
    return;
  }
  requireLookupProof(request);
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
    const payload = `${expires}.${randomBytes(16).toString('base64url')}.${network(settings.secret, request)}`;
    return { proof: `${payload}.${signature(settings.secret, payload, request).toString('base64url')}`, expiresAt: expires * 1_000 };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Never attach upstream request diagnostics, which could contain the secret or token.
    throw new HttpError(503, 'Browser verification is temporarily unavailable. Try again shortly.', { 'Retry-After': '5' });
  } finally {
    logOperationalEvent('lookup_verification', { outcome, duration_ms: Math.round(performance.now() - started) });
  }
}
