/**
 * The single error taxonomy for carrier adapters, universal providers, routing
 * and telemetry.
 *
 * Adapters throw one of the classes below (or let `fetchBounded` throw its
 * `UpstreamHttpError` / `UpstreamNetworkError`). Routing, the sync worker and
 * the telemetry sinks never inspect messages or class names: they call
 * `carrierErrorKind()`, which walks the `cause` chain so wrapped errors keep
 * their meaning.
 *
 * `status` mirrors the HTTP-like convention older code still inspects (404 not
 * found, 429 rate limited, 403 challenge, 502 indeterminate, 503 maintenance),
 * which keeps the migration behavior-preserving.
 */

import type { UpstreamHttpDiagnostics } from '../transport/upstreamHttpDiagnostics';

export type { UpstreamHttpDiagnostics };

export type CarrierErrorKind =
  | 'not_found'       // the provider positively says it does not know the shipment
  | 'indeterminate'   // the provider answered, but the answer proves nothing (empty 500, maintenance page...)
  | 'challenge'       // bot protection or an interactive verification blocked the request
  | 'rate_limited'    // HTTP 429 or an explicit throttle; carries retryAfterMs when known
  | 'maintenance'     // the provider announced planned unavailability
  | 'schema'          // the payload did not have the expected shape or identity
  | 'input_required'  // the lookup needs a postcode or capability URL the parcel does not have
  | 'transport'       // network failure, timeout, or a browser service that could not help
  | 'budget';         // the lookup ran out of its time budget before any step succeeded

const STATUS_BY_KIND: Partial<Record<CarrierErrorKind, number>> = {
  not_found: 404,
  indeterminate: 502,
  challenge: 403,
  rate_limited: 429,
  maintenance: 503,
};

export interface CarrierErrorOptions {
  cause?: unknown;
  status?: number;
  retryAfterMs?: number;
}

export class CarrierError extends Error {
  readonly kind: CarrierErrorKind;
  readonly provider: string;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(kind: CarrierErrorKind, provider: string, message: string, options: CarrierErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CarrierError';
    this.kind = kind;
    this.provider = provider;
    const status = options.status ?? STATUS_BY_KIND[kind];
    if (status !== undefined) this.status = status;
    if (options.retryAfterMs !== undefined && Number.isFinite(options.retryAfterMs)) {
      this.retryAfterMs = Math.max(0, options.retryAfterMs);
    }
  }
}

export class NotFoundError extends CarrierError {
  constructor(provider: string, message = `${provider} could not locate the shipment`, options?: CarrierErrorOptions) {
    super('not_found', provider, message, options);
    this.name = 'NotFoundError';
  }
}

export class IndeterminateError extends CarrierError {
  constructor(provider: string, message = `${provider} returned an inconclusive response`, options?: CarrierErrorOptions) {
    super('indeterminate', provider, message, options);
    this.name = 'IndeterminateError';
  }
}

export class ChallengeError extends CarrierError {
  constructor(provider: string, message = `${provider} requires a browser challenge`, options?: CarrierErrorOptions) {
    super('challenge', provider, message, options);
    this.name = 'ChallengeError';
  }
}

export class RateLimitedError extends CarrierError {
  constructor(provider: string, retryAfterMs?: number, message = `${provider} is rate limiting tracking requests`, options?: CarrierErrorOptions) {
    super('rate_limited', provider, message, { ...options, retryAfterMs });
    this.name = 'RateLimitedError';
  }
}

export class MaintenanceError extends CarrierError {
  constructor(provider: string, message = `${provider} tracking is under maintenance`, options?: CarrierErrorOptions) {
    super('maintenance', provider, message, options);
    this.name = 'MaintenanceError';
  }
}

export class SchemaError extends CarrierError {
  constructor(provider: string, message = `${provider} returned an invalid tracking response`, options?: CarrierErrorOptions) {
    super('schema', provider, message, options);
    this.name = 'SchemaError';
  }
}

export class InputRequiredError extends CarrierError {
  readonly field: string;

  constructor(provider: string, field: string, message = `${provider} tracking requires ${field}`, options?: CarrierErrorOptions) {
    super('input_required', provider, message, options);
    this.name = 'InputRequiredError';
    this.field = field;
  }
}

export class TransportError extends CarrierError {
  constructor(provider: string, message = `${provider} is unreachable`, options?: CarrierErrorOptions) {
    super('transport', provider, message, options);
    this.name = 'TransportError';
  }
}

export class BudgetExceededError extends CarrierError {
  constructor(provider: string, budgetMs: number, options?: CarrierErrorOptions) {
    super('budget', provider, `${provider} lookup exceeded its ${budgetMs} ms budget`, options);
    this.name = 'BudgetExceededError';
  }
}

/** Request details kept on transport errors for diagnostics. Bodies are truncated. */
export interface UpstreamRequestDiagnostics {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  body_truncated?: boolean;
  timeout_ms: number;
}

function kindForStatus(status: number): CarrierErrorKind {
  if (status === 404 || status === 410) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'challenge';
  if (status === 503) return 'maintenance';
  if (status >= 500) return 'indeterminate';
  return 'transport';
}

/** A rejected HTTP response from a provider. Kind is derived from the status. */
export class UpstreamHttpError extends CarrierError {
  constructor(
    provider: string,
    status: number,
    retryAfterMs?: number,
    readonly diagnostics?: UpstreamHttpDiagnostics,
    readonly request?: UpstreamRequestDiagnostics,
  ) {
    super(kindForStatus(status), provider, `${provider} returned HTTP ${status}`, { status, retryAfterMs });
    this.name = 'UpstreamHttpError';
  }
}

/** A network failure (DNS, TLS, timeout, interrupted body) while talking to a provider. */
export class UpstreamNetworkError extends CarrierError {
  constructor(provider: string, cause: unknown, readonly request?: UpstreamRequestDiagnostics) {
    super('transport', provider, `${provider} is unreachable`, { cause });
    this.name = 'UpstreamNetworkError';
  }
}

const MAX_CAUSE_DEPTH = 8;

/**
 * Classify any error, walking `cause` chains. Returns null for errors that are
 * not part of the taxonomy so callers can apply their own fallback.
 */
export function carrierErrorKind(error: unknown): CarrierErrorKind | null {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof CarrierError) return current.kind;
    current = current.cause;
  }
  return null;
}

/** The retry window a rate-limiting provider asked for, when any error in the chain carries one. */
export function retryAfterMsOf(error: unknown): number | undefined {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof CarrierError && current.retryAfterMs !== undefined) return current.retryAfterMs;
    current = current.cause;
  }
  return undefined;
}

/** A stable, low-cardinality name for an error, safe as a metric label. */
export function errorTypeOf(error: unknown): string {
  if (error instanceof Error && /^(?:Error|[A-Z][A-Za-z0-9_.-]{0,80}(?:Error|Exception))$/.test(error.name.trim())) {
    return error.name.trim();
  }
  if (error instanceof Error) return 'Error';
  return typeof error;
}
