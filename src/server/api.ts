import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';
import { authenticator, SupabaseAuthError, SupabaseAuthUnavailableError, type SupabaseUser } from './auth';
import { captureOperationalError, logOperationalEvent } from './observability';
import { RateLimiter } from './rateLimit';
import { serviceClient } from './runtime';
import {
  SupabaseError,
  type SupabaseServiceClient,
  type SupabaseUserClient,
} from './supabase';
import { errorMessage, isRecord, type JsonObject } from './types';

const MAX_JSON_BODY = 16_384;
const PREAUTH_REQUEST_LIMIT = 300;
const PREAUTH_REQUEST_WINDOW_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rateLimiter = new RateLimiter();

export interface RouteParameters {
  [key: string]: string | string[];
}

export interface RouteContext<Parameters extends RouteParameters = RouteParameters> {
  params: Promise<Parameters>;
}

export interface ApiContext<Parameters extends RouteParameters = RouteParameters> {
  request: NextRequest;
  route: RouteContext<Parameters>;
  requestId: string;
  user: SupabaseUser | null;
  token: string | null;
  userClient: SupabaseUserClient | null;
  service: SupabaseServiceClient | null;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers?: HeadersInit,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'HttpError';
  }
}

interface ApiRouteOptions {
  authenticated?: boolean;
  serviceRequired?: boolean;
  loadService?: boolean;
  /**
   * Requests per client address for a route without sign-in. Each address of
   * the route has its own allowance unless `bucket` names one to share, as the
   * addresses of one route with an id in them must. `onLimited` counts refusals.
   */
  publicRateLimit?: { limit: number; window: number; bucket?: string; onLimited?: () => void };
  /**
   * The request's address, headers or body carry a capability (a parcel link
   * id, an owner key). Error reports for the route leave the request out.
   */
  capability?: boolean;
}

type ApiHandler<Parameters extends RouteParameters> = (
  context: ApiContext<Parameters>,
) => Response | Promise<Response>;

function ratePolicy(method: string, pathname: string): {
  bucket: string;
  limit: number;
  window: number;
} {
  if (pathname === '/api/sync' || pathname.endsWith('/sync')) {
    return { bucket: 'sync', limit: 12, window: 300 };
  }
  if (method === 'GET' || method === 'HEAD') {
    return { bucket: 'read', limit: 240, window: 60 };
  }
  return { bucket: 'write', limit: 60, window: 60 };
}

export function clientIp(request: Pick<Request, 'headers'>): string {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') return 'untrusted';
  const candidate = request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim()
    || '';
  return isIP(candidate) ? candidate : 'unknown';
}

/**
 * The address a limit without sign-in counts. An IPv6 client is its /64: a
 * line is given a whole one, and privacy addresses rotate inside it.
 */
export function clientNetwork(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  const [head = '', tail = ''] = ip.split('::');
  const leading = head ? head.split(':') : [];
  const trailing = tail ? tail.split(':') : [];
  // "::" stands for the groups left out of the eight.
  const groups = ip.includes('::')
    ? [...leading, ...Array<string>(Math.max(0, 8 - leading.length - trailing.length)).fill('0'), ...trailing]
    : leading;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '').toLowerCase()).join(':')}::/64`;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

function apiResponse(
  status: number,
  payload: unknown,
  headers?: HeadersInit,
): Response {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

export function json(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return apiResponse(status, payload, headers);
}

export function noContent(status = 204, headers?: HeadersInit): Response {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function failure(error: unknown): Response {
  if (error instanceof HttpError) {
    return apiResponse(error.status, { error: error.message }, error.headers);
  }
  if (error instanceof SupabaseError) {
    if (error.status === 401 || error.status === 403) {
      return apiResponse(401, { error: 'Authentication is required' });
    }
    return apiResponse(502, { error: 'The delivery database is temporarily unavailable' });
  }
  return apiResponse(500, { error: 'The request could not be completed' });
}

/** The route as logs and error tags name it: without ids, and never with a parcel link id, which is a capability. */
function routeLabel(request: Request): string {
  try {
    return new URL(request.url).pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
      .replace(/^(\/api\/public\/parcels\/)[^/]+/, '$1:link');
  } catch {
    return 'unknown';
  }
}

function logRequest(
  request: Request,
  requestId: string,
  status: number,
  startedAt: number,
  error?: unknown,
): void {
  const payload: JsonObject = {
    request_id: requestId,
    method: request.method,
    route: routeLabel(request),
    status,
    duration_ms: Math.round((performance.now() - startedAt) * 10) / 10,
  };
  if (error) payload.error_class = error instanceof Error ? error.name : typeof error;
  // A 502 names the upstream failure behind it: a timeout, an HTTP status, a login.
  if (error instanceof HttpError && error.cause instanceof Error) payload.error_cause = error.cause.name;
  logOperationalEvent('http_request', payload, status >= 500 ? 'error' : 'info');
}

export function apiRoute<Parameters extends RouteParameters = RouteParameters>(
  handler: ApiHandler<Parameters>,
  options: ApiRouteOptions = {},
): (
  request: NextRequest,
  route: RouteContext<Parameters>,
) => Promise<Response> {
  const authenticated = options.authenticated ?? true;
  return async (request, route) => {
    const requestId = randomUUID().replaceAll('-', '');
    const startedAt = performance.now();
    let response: Response;
    let caught: unknown;
    try {
      const token = bearerToken(request);
      let user: SupabaseUser | null = null;
      let userClient: SupabaseUserClient | null = null;

      if (!authenticated && options.publicRateLimit) {
        const { limit, window, bucket, onLimited } = options.publicRateLimit;
        const retryAfter = rateLimiter.retryAfter(
          `public:${bucket ?? new URL(request.url).pathname}:${clientNetwork(clientIp(request))}`,
          { limit, window },
        );
        if (retryAfter) {
          onLimited?.();
          throw new HttpError(429, 'Too many requests. Try again shortly.', { 'Retry-After': String(retryAfter) });
        }
      }

      if (authenticated) {
        const credential = token
          ? createHash('sha256').update(token).digest('hex').slice(0, 24)
          : null;
        const ip = clientIp(request);
        // Unknown callers must not share an admission bucket with every signed-in user.
        let retryAfter = isIP(ip) ? rateLimiter.retryAfter(`preauth-client:${ip}`, {
          limit: PREAUTH_REQUEST_LIMIT * 3,
          window: PREAUTH_REQUEST_WINDOW_SECONDS,
        }) : 0;
        if (!retryAfter && credential) {
          retryAfter = rateLimiter.retryAfter(`preauth-credential:${credential}`, {
            limit: PREAUTH_REQUEST_LIMIT,
            window: PREAUTH_REQUEST_WINDOW_SECONDS,
          });
        }
        if (retryAfter) {
          throw new HttpError(
            429,
            'Too many authentication attempts. Try again shortly.',
            { 'Retry-After': String(retryAfter) },
          );
        }

        let auth;
        try {
          auth = authenticator();
        } catch (error) {
          throw new HttpError(503, 'Supabase authentication is not configured', undefined, {
            cause: error,
          });
        }
        if (!auth) throw new HttpError(503, 'Supabase authentication is not configured');
        if (!token) throw new HttpError(401, 'Authentication is required');
        try {
          user = await auth.validate(token);
        } catch (error) {
          if (error instanceof SupabaseAuthError) {
            throw new HttpError(401, 'Authentication is required', undefined, { cause: error });
          }
          if (error instanceof SupabaseAuthUnavailableError) {
            throw new HttpError(503, error.message, { 'Retry-After': '5' }, { cause: error });
          }
          throw error;
        }
        const policy = ratePolicy(request.method, new URL(request.url).pathname);
        retryAfter = rateLimiter.retryAfter(`${user.id}:${policy.bucket}`, {
          limit: policy.limit,
          window: policy.window,
        });
        if (retryAfter) {
          throw new HttpError(429, 'Too many requests. Try again shortly.', {
            'Retry-After': String(retryAfter),
          });
        }
        userClient = auth.userClient(token);
      }

      let service: SupabaseServiceClient | null = null;
      if (options.loadService ?? true) {
        try {
          service = serviceClient();
        } catch (error) {
          throw new HttpError(503, 'The delivery database is not configured', undefined, {
            cause: error,
          });
        }
      }
      if (options.serviceRequired && !service) {
        throw new HttpError(503, 'The delivery database is not configured');
      }
      response = await handler({
        request,
        route,
        requestId,
        user,
        token,
        userClient,
        service,
      });
    } catch (error) {
      caught = error;
      response = failure(error);
    }

    const headers = new Headers(response.headers);
    headers.set('X-Request-ID', requestId);
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
    const finalized = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    logRequest(request, requestId, finalized.status, startedAt, caught);
    if (caught && finalized.status >= 500) {
      captureOperationalError(caught, {
        component: 'api',
        operation: 'request',
        requestId,
        route: routeLabel(request),
        withoutRequest: options.capability,
      });
    }
    return finalized;
  };
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!/^\d+$/.test(declaredLength) || length <= 0 || length > MAX_JSON_BODY) {
      await request.body?.cancel().catch(() => undefined);
      throw new HttpError(400, 'Invalid request size');
    }
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Invalid request size');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_JSON_BODY) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(400, 'Invalid request size');
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    await reader.cancel().catch(() => undefined);
    throw new HttpError(400, 'Send a valid JSON object', undefined, { cause: error });
  } finally {
    reader.releaseLock();
  }
  const text = parts.join('');
  if (!text) {
    throw new HttpError(400, 'Invalid request size');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new HttpError(400, 'Send a valid JSON object', undefined, { cause: error });
  }
  if (!isRecord(payload)) throw new HttpError(400, 'Send a valid JSON object');
  return payload;
}

export function requireUser(context: ApiContext): SupabaseUser {
  if (!context.user) throw new HttpError(401, 'Authentication is required');
  return context.user;
}

export function requireUserClient(context: ApiContext): SupabaseUserClient {
  if (!context.userClient) throw new HttpError(401, 'Authentication is required');
  return context.userClient;
}

export function requireService(context: ApiContext): SupabaseServiceClient {
  if (!context.service) throw new HttpError(503, 'The delivery database is not configured');
  return context.service;
}

export function parseUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new HttpError(400, `Invalid ${label}`);
  return value.toLowerCase();
}

export function validationError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  throw new HttpError(400, errorMessage(error), undefined, { cause: error });
}
