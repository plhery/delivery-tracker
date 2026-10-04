import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import cbor from 'cbor';
import { verifyAssertion, verifyAttestation } from 'node-app-attest';
import { clientIp, clientNetwork, HttpError } from './api';
import { logOperationalEvent } from './observability';
import { requestHostname } from './siteHosts';
import type { SupabaseServiceClient } from './supabase';

const CHALLENGE_SECONDS = 120;
const KEY_ID = /^[A-Za-z0-9+/]{43}=$/;
const rejected = () => new HttpError(403, 'Please verify this device and try again.', { 'X-Lookup-Verification': 'required' });

export function nativeAttestSettings(env: Record<string, string | undefined> = process.env) {
  const appId = env.APP_ATTEST_APP_ID?.trim();
  if (!appId) return null;
  const match = /^([A-Z0-9]{10})\.([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/.exec(appId);
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!match || !secret) throw new Error('APP_ATTEST_APP_ID requires a valid app ID and TURNSTILE_SECRET_KEY');
  const development = env.APP_ATTEST_ALLOW_DEVELOPMENT === 'true';
  if (development && env.NODE_ENV === 'production') throw new Error('Development App Attest keys must not be accepted in production');
  return { appId, teamIdentifier: match[1]!, bundleIdentifier: match[2]!, secret, development };
}

function challengeSignature(request: Request, payload: string, keyId: string, purpose: string): Buffer {
  const settings = nativeAttestSettings();
  if (!settings) throw new HttpError(503, 'App verification is not configured');
  const hostname = requestHostname(request.headers) ?? new URL(request.url).hostname;
  return createHmac('sha256', settings.secret).update(
    `native-challenge-v1\n${settings.appId}\n${hostname}\n${clientNetwork(clientIp(request))}\n${keyId}\n${purpose}\n${payload}`,
  ).digest();
}

export function nativeChallenge(request: Request, keyId: unknown, purpose: unknown) {
  if (typeof keyId !== 'string' || !KEY_ID.test(keyId) || (purpose !== 'attestation' && purpose !== 'assertion')) {
    throw new HttpError(400, 'Invalid verification challenge');
  }
  const expires = Math.floor(Date.now() / 1_000) + CHALLENGE_SECONDS;
  const payload = `${expires}.${randomBytes(32).toString('base64url')}`;
  return { challenge: `${payload}.${challengeSignature(request, payload, keyId, purpose).toString('base64url')}`, expiresAt: expires * 1_000 };
}

function checkChallenge(request: Request, challenge: unknown, keyId: string, purpose: string) {
  if (typeof challenge !== 'string') throw rejected();
  const match = /^(\d{10})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(challenge);
  const now = Math.floor(Date.now() / 1_000);
  if (!match || Number(match[1]) <= now || Number(match[1]) > now + CHALLENGE_SECONDS) throw rejected();
  const expected = challengeSignature(request, `${match[1]}.${match[2]}`, keyId, purpose);
  const received = Buffer.from(match[3]!, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw rejected();
  return { hash: createHash('sha256').update(challenge).digest('hex'), expires: new Date(Number(match[1]) * 1_000).toISOString() };
}

function binary(value: unknown, max: number): Buffer {
  if (typeof value !== 'string' || !value || value.length > max || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw rejected();
  return Buffer.from(value, 'base64');
}

/** Bound decoding and certificate lifetimes supplement the protocol verifier. */
function checkedAttestation(value: unknown, development: boolean): Buffer {
  const bytes = binary(value, 14_000);
  const decoded = cbor.decodeAllSync(bytes, { max_depth: 16 });
  if (decoded.length !== 1 || !Array.isArray(decoded[0]?.attStmt?.x5c) || decoded[0].attStmt.x5c.length !== 2) throw rejected();
  for (const encoded of decoded[0].attStmt.x5c) {
    if (!Buffer.isBuffer(encoded)) throw rejected();
    const cert = new X509Certificate(encoded);
    if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) throw rejected();
  }
  checkExtensions(decoded[0].authData, true, development);
  return bytes;
}

/** Newer systems add signed launch-category and bundle-version extensions. */
function checkExtensions(data: unknown, attestation: boolean, development: boolean) {
  if (!Buffer.isBuffer(data) || data.length < (attestation ? 87 : 37)) throw rejected();
  if (!(data[32]! & 0x80)) return;
  const offset = attestation ? 55 + data.readUInt16BE(53) : 37;
  const decoded = cbor.decodeAllSync(data.subarray(offset), { max_depth: 16 });
  const extensions = decoded[attestation ? 1 : 0];
  if (decoded.length !== (attestation ? 2 : 1) || !extensions || typeof extensions !== 'object') throw rejected();
  const category = extensions.apple_validation_category_01 ?? extensions.validationCategory;
  const version = extensions.apple_bundle_version_01 ?? extensions.bundleVersion;
  if (category !== undefined && ![2, 4, 5, ...(development ? [3] : [])].includes(category)) throw rejected();
  if (version !== undefined && (typeof version !== 'string' || !/^\d{1,10}(?:\.\d{1,10}){0,2}$/.test(version))) throw rejected();
}

export async function registerNativeKey(request: Request, service: SupabaseServiceClient, body: Record<string, unknown>) {
  const settings = nativeAttestSettings();
  if (!settings) throw new HttpError(503, 'App verification is not configured');
  const { keyId, challenge } = body;
  if (typeof keyId !== 'string' || !KEY_ID.test(keyId)) throw rejected();
  const checked = checkChallenge(request, challenge, keyId, 'attestation');
  let publicKey: string;
  try {
    const result = verifyAttestation({ attestation: checkedAttestation(body.attestation, settings.development), challenge, keyId,
      teamIdentifier: settings.teamIdentifier, bundleIdentifier: settings.bundleIdentifier,
      allowDevelopmentEnvironment: settings.development });
    publicKey = result.publicKey;
    if (typeof publicKey !== 'string' || publicKey.length > 1_024) throw rejected();
  } catch {
    logOperationalEvent('native_verification', { outcome: 'rejected', kind: 'attestation' });
    throw rejected();
  }
  const accepted = await service.request('/rest/v1/rpc/register_native_attest_key', { method: 'POST', body: {
    p_key_id: keyId, p_public_key: publicKey, p_app_id: settings.appId, p_challenge: checked.hash, p_expires: checked.expires,
  } });
  if (accepted !== true) throw rejected();
  logOperationalEvent('native_verification', { outcome: 'verified', kind: 'attestation' });
}

export function nativeRequestPayload(request: Request, challenge: string, rawBody: Buffer): string {
  return `native-request-v1\n${challenge}\n${request.method}\n${new URL(request.url).pathname}\n${createHash('sha256').update(rawBody).digest('hex')}`;
}

export async function verifyNativeRequest(request: Request, service: SupabaseServiceClient) {
  const settings = nativeAttestSettings();
  if (!settings) throw rejected();
  const keyId = request.headers.get('x-app-attest-key-id') ?? '';
  const challenge = request.headers.get('x-app-attest-challenge') ?? '';
  if (!KEY_ID.test(keyId)) throw rejected();
  const checked = checkChallenge(request, challenge, keyId, 'assertion');
  const stored = await service.request<{ public_key: string; app_id: string; sign_count: number }>('/rest/v1/rpc/get_native_attest_key', {
    method: 'POST', body: { p_key_id: keyId },
  });
  if (!stored || stored.app_id !== settings.appId) throw rejected();
  const raw = Buffer.from(await request.clone().arrayBuffer());
  if (raw.length > 16_384) throw new HttpError(413, 'Request body is too large');
  let counter: number;
  try {
    const assertion = binary(request.headers.get('x-app-attest-assertion'), 4_096);
    const decoded = cbor.decodeAllSync(assertion, { max_depth: 16 });
    if (decoded.length !== 1 || !Buffer.isBuffer(decoded[0]?.signature) || !Buffer.isBuffer(decoded[0]?.authenticatorData)
      || decoded[0].authenticatorData.length < 37) throw rejected();
    checkExtensions(decoded[0].authenticatorData, false, settings.development);
    counter = verifyAssertion({ assertion, payload: nativeRequestPayload(request, challenge, raw), publicKey: stored.public_key,
      teamIdentifier: settings.teamIdentifier, bundleIdentifier: settings.bundleIdentifier, signCount: stored.sign_count }).signCount;
    if (!Number.isSafeInteger(counter) || counter <= 0) throw rejected();
  } catch {
    logOperationalEvent('native_verification', { outcome: 'rejected', kind: 'assertion' });
    throw rejected();
  }
  const kind = new URL(request.url).pathname === '/api/public/parcels' ? 'lookup' : 'detection';
  const configured = process.env[kind === 'lookup' ? 'NATIVE_LOOKUPS_PER_DAY' : 'NATIVE_DETECTIONS_PER_DAY'];
  const limit = configured && /^\d{1,6}$/.test(configured) ? Number(configured) : kind === 'lookup' ? 15 : 60;
  const outcome = await service.request('/rest/v1/rpc/accept_native_assertion', { method: 'POST', body: {
    p_key_id: keyId, p_counter: counter, p_challenge: checked.hash, p_expires: checked.expires, p_kind: kind, p_limit: limit,
  } });
  if (outcome === 'limited') {
    logOperationalEvent('native_verification', { outcome: 'limited', kind });
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    throw new HttpError(429, 'Today’s device allowance is used up. Try again tomorrow.', { 'Retry-After': String(Math.ceil((midnight - now.getTime()) / 1_000)) });
  }
  if (outcome !== 'accepted') throw rejected();
  logOperationalEvent('native_verification', { outcome: 'verified', kind: 'assertion' });
}
