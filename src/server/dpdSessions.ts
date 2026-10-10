import 'server-only';

import type { DpdSessionEvent, DpdSessionStore } from 'universal-parcel-scraper/node';
import { recordDpdAppSession } from './metrics';
import { errorType, logOperationalEvent } from './observability';
import type { SupabaseServiceClient } from './supabase';

/**
 * Keeps the sessions the scraper reads DPD's app service with in the database,
 * so that a deploy takes the current one up again instead of opening another,
 * and logs how long DPD accepted each one once it refuses it. The scraper
 * carries on without the store when it fails.
 */
export function dpdSessionStore(client: Pick<SupabaseServiceClient, 'dpdAppSessions' | 'saveDpdAppSession'>): DpdSessionStore {
  return {
    load: () => logged('load', () => client.dpdAppSessions()),
    save: (session) => {
      if (session.refusedAt !== undefined) {
        logOperationalEvent('dpd_app_session_refused', {
          accepted_ms: session.refusedAt - session.openedAt,
          ...(session.checkedAt !== undefined ? { last_accepted_ms: session.checkedAt - session.openedAt } : {}),
        });
      }
      return logged('save', () => client.saveDpdAppSession(session));
    },
  };
}

/**
 * Logs the session the scraper takes up at start, and each opening once it ends, with
 * what began it and how long it took. An opening that fails is a warning: lookups then
 * wait for one of their own, and the scraper tries again a quarter of an hour later.
 */
export function logDpdSession(event: DpdSessionEvent): void {
  recordDpdAppSession(event.outcome, event.trigger);
  logOperationalEvent('dpd_app_session', {
    outcome: event.outcome,
    trigger: event.trigger,
    duration_ms: Math.round(event.durationMs),
    ...(event.ageMs !== undefined ? { age_ms: Math.round(event.ageMs) } : {}),
    ...(event.errorKind !== undefined ? { error_kind: event.errorKind } : {}),
  }, event.outcome === 'failed' ? 'warning' : 'info');
}

async function logged<T>(operation: 'load' | 'save', run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logOperationalEvent('dpd_app_session_store_failed', { operation, error_type: errorType(error) }, 'warning');
    throw error;
  }
}
