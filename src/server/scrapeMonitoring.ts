import 'server-only';

import * as Sentry from '@sentry/node';
import { errorType, initObservability, logOperationalEvent, reportRoutingEvent } from './observability';

export type ScrapePhase = 'total' | 'direct' | 'trawl' | 'browser' | 'page';

function metric(operation: () => void): void {
  try {
    if (!initObservability()) return;
    operation();
  } catch { /* Telemetry must never change a tracking result. */ }
}

export async function measureScrape<T>(carrier: string, phase: ScrapePhase, operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let outcome = 'success';
  let errorClass = 'none';
  try { return await operation(); }
  catch (error) { outcome = 'error'; errorClass = errorType(error); throw error; }
  finally {
    const duration = Math.max(0, performance.now() - started);
    const attributes = { carrier, phase, outcome, error_type: errorClass };
    try { logOperationalEvent('tracking_scrape', { ...attributes, duration_ms: Math.round(duration) }); }
    catch { /* Preserve the original result even if logging fails. */ }
    metric(() => {
      Sentry.metrics.distribution('tracking.scrape.duration', duration, { unit: 'millisecond', attributes });
      Sentry.metrics.count('tracking.scrape.attempts', 1, { attributes });
    });
  }
}

export async function recoverScrape<T>(
  carrier: string, phase: Exclude<ScrapePhase, 'direct' | 'total'>, error: unknown, operation: () => Promise<T>,
): Promise<T> {
  // Report before starting the fallback, including when it ultimately succeeds.
  try { reportRoutingEvent('transport_fallback', { carrier, provider: carrier, category: phase,
    errorClass: errorType(error), error }); } catch { /* Recovery must still run. */ }
  metric(() => Sentry.metrics.count('tracking.scrape.fallbacks', 1, {
    attributes: { carrier, from_phase: 'direct', to_phase: phase, error_type: errorType(error) },
  }));
  return measureScrape(carrier, phase, operation);
}
