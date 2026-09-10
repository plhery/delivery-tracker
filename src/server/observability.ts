import 'server-only';

import * as Sentry from '@sentry/node';
import type { JsonObject } from './types';

const PRIVATE_LOG_KEY = /(?:tracking|package|parcel|user|label|description|location|status_text|url|token|cookie|authorization|secret|password)/i;

let initialized = false;

export interface OperationalContext {
  component: string;
  operation: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  anomalyCode?: string | null;
  attemptId?: string | null;
  jobId?: string | null;
  trigger?: string | null;
  route?: string | null;
  routeType?: string | null;
  requestId?: string | null;
  failureCount?: number | null;
  durationMs?: number | null;
  eventsReceived?: number | null;
  eventsNormalized?: number | null;
  previousStage?: string | null;
  providerStatus?: string | null;
  reportedStage?: string | null;
  selectedStage?: string | null;
}

export interface ScheduledCheckIn {
  checkInId: string;
  monitorSlug: string;
  startedAt: number;
}

export interface OperationalErrorMetadata {
  upstreamStatus?: number;
  databaseStatus?: number;
  databaseCode?: string;
}

export function errorType(error: unknown): string {
  if (
    error instanceof Error
    && /^(?:Error|[A-Z][A-Za-z0-9_.-]{0,80}(?:Error|Exception))$/.test(error.name.trim())
  ) {
    return error.name.trim();
  }
  if (error instanceof Error) return 'Error';
  return typeof error;
}

export function parseSampleRate(value: string | undefined, fallback = 0): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function resolveSentryRelease(
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  const imageCommit = environment.IMAGE_COMMIT?.trim();
  if (imageCommit && /^[0-9a-f]{40}$/i.test(imageCommit)) return imageCommit;
  const configured = environment.SENTRY_RELEASE?.trim();
  if (!configured || /^(?:head|latest|unknown)$/i.test(configured)) return undefined;
  return configured.slice(0, 200);
}

function boundedText(value: unknown, maximum = 200): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim().slice(0, maximum);
  return text || undefined;
}

function safeNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 100
    && value <= 599
    ? value
    : undefined;
}

function safeDatabaseCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(value)
    ? value
    : undefined;
}

export function operationalErrorMetadata(error: unknown): OperationalErrorMetadata {
  const metadata: OperationalErrorMetadata = {};
  const seen = new Set<Error>();
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 8; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const details = current as Error & { status?: unknown; code?: unknown };
    if (current.name === 'UpstreamHttpError' && metadata.upstreamStatus === undefined) {
      metadata.upstreamStatus = safeHttpStatus(details.status);
    }
    if (current.name === 'SupabaseError') {
      if (metadata.databaseStatus === undefined) {
        metadata.databaseStatus = safeHttpStatus(details.status);
      }
      if (metadata.databaseCode === undefined) {
        metadata.databaseCode = safeDatabaseCode(details.code);
      }
    }
    current = current.cause;
  }
  return metadata;
}

export function initObservability(): boolean {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || 'development',
    release: resolveSentryRelease(),
    dataCollection: { userInfo: true },
    tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
    integrations: [
      ...Sentry.getDefaultIntegrationsWithoutPerformance(),
      Sentry.extraErrorDataIntegration(),
    ],
  });
  initialized = true;
  return true;
}

function applyContext(
  scope: Sentry.Scope,
  context: OperationalContext,
  capturedErrorType?: string,
  errorMetadata: OperationalErrorMetadata = {},
): void {
  const tags: Record<string, string | undefined> = {
    anomaly_code: boundedText(context.anomalyCode, 100),
    attempt_id: boundedText(context.attemptId, 100),
    carrier: boundedText(context.carrier, 100),
    component: boundedText(context.component, 100),
    database_code: boundedText(errorMetadata.databaseCode, 40),
    database_status: boundedText(errorMetadata.databaseStatus, 3),
    error_type: boundedText(capturedErrorType, 100),
    job_id: boundedText(context.jobId, 100),
    operation: boundedText(context.operation, 100),
    request_id: boundedText(context.requestId, 100),
    route: boundedText(context.route),
    route_type: boundedText(context.routeType, 100),
    trigger: boundedText(context.trigger, 100),
    tracking_number: boundedText(context.trackingNumber, 40),
    upstream_status: boundedText(errorMetadata.upstreamStatus, 3),
  };
  for (const [key, value] of Object.entries(tags)) {
    if (value) scope.setTag(key, value);
  }
  const extras: Record<string, string | number | undefined> = {
    attempt_id: boundedText(context.attemptId, 100),
    duration_ms: safeNumber(context.durationMs),
    events_normalized: safeNumber(context.eventsNormalized),
    events_received: safeNumber(context.eventsReceived),
    failure_count: safeNumber(context.failureCount),
    job_id: boundedText(context.jobId, 100),
    previous_stage: boundedText(context.previousStage, 100),
    provider_status: boundedText(context.providerStatus, 100),
    reported_stage: boundedText(context.reportedStage, 100),
    request_id: boundedText(context.requestId, 100),
    selected_stage: boundedText(context.selectedStage, 100),
  };
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined) scope.setExtra(key, value);
  }
}

export function captureOperationalError(
  error: unknown,
  context: OperationalContext,
): string | null {
  if (!initObservability()) return null;
  const capturedErrorType = errorType(error);
  const errorMetadata = operationalErrorMetadata(error);
  let eventId: string | null = null;
  Sentry.withScope((scope) => {
    applyContext(scope, context, capturedErrorType, errorMetadata);
    scope.setFingerprint([
      'delivery-tracker',
      context.component,
      context.operation,
      context.carrier ?? 'none',
      capturedErrorType,
    ]);
    eventId = Sentry.captureException(error);
  });
  return eventId;
}

export function captureSyncAnomaly(
  anomalyCode: string,
  context: Omit<OperationalContext, 'anomalyCode'>,
): string | null {
  if (!initObservability()) return null;
  let eventId: string | null = null;
  Sentry.withScope((scope) => {
    applyContext(scope, { ...context, anomalyCode }, 'TrackingSyncAnomaly');
    scope.setLevel('warning');
    scope.setFingerprint([
      'delivery-tracker',
      'tracking-sync-anomaly',
      context.carrier ?? 'none',
      anomalyCode,
    ]);
    eventId = Sentry.captureMessage(`Tracking sync anomaly: ${anomalyCode}`);
  });
  return eventId;
}

function sanitizeLogValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 500);
  return undefined;
}

export function logOperationalEvent(
  event: string,
  fields: JsonObject = {},
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  const safeFields = Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => key === 'tracking_number' || !PRIVATE_LOG_KEY.test(key))
      .map(([key, value]) => [key, sanitizeLogValue(value)] as const)
      .filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined),
  );
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: event.slice(0, 100),
    ...safeFields,
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warning') console.warn(payload);
  else console.log(payload);
}

export function shouldReportRepeatedFailure(failureCount: number): boolean {
  return Number.isInteger(failureCount)
    && failureCount > 0
    && (failureCount <= 3 || (failureCount & (failureCount - 1)) === 0);
}

function zurichHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Zurich',
  }).format(now));
}

export function beginScheduledSyncCheckIn(now = new Date()): ScheduledCheckIn | null {
  if (!initObservability()) return null;
  const daytime = zurichHour(now) >= 8 && zurichHour(now) < 22;
  const monitorSlug = daytime
    ? 'delivery-tracker-sync-daytime'
    : 'delivery-tracker-sync-overnight';
  const checkInId = Sentry.captureCheckIn({ monitorSlug, status: 'in_progress' }, {
    schedule: {
      type: 'crontab',
      value: daytime ? '*/2 8-21 * * *' : '0 0-7,22-23 * * *',
    },
    checkinMargin: daytime ? 5 : 15,
    maxRuntime: 30,
    timezone: 'Europe/Zurich',
    failureIssueThreshold: 1,
    recoveryThreshold: 1,
  });
  return { checkInId, monitorSlug, startedAt: now.getTime() };
}

export function finishScheduledSyncCheckIn(
  checkIn: ScheduledCheckIn | null,
  status: 'ok' | 'error',
  now = new Date(),
): void {
  if (!checkIn || !initialized) return;
  Sentry.captureCheckIn({
    monitorSlug: checkIn.monitorSlug,
    checkInId: checkIn.checkInId,
    status,
    duration: Math.max(0, now.getTime() - checkIn.startedAt) / 1000,
  });
}

export async function flushObservability(timeoutMs = 2_000): Promise<boolean> {
  return initialized ? await Sentry.flush(timeoutMs) : true;
}
