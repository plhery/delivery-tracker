import 'server-only';

import type { DpdSessionStore } from 'universal-parcel-scraper/node';
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

async function logged<T>(operation: 'load' | 'save', run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logOperationalEvent('dpd_app_session_store_failed', { operation, error_type: errorType(error) }, 'warning');
    throw error;
  }
}
