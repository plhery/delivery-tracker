import { afterEach, describe, expect, it, vi } from 'vitest';
import { dpdSessionStore } from './dpdSessions';
import * as observability from './observability';

const HOUR = 3_600_000;
const OPENED = Date.parse('2026-10-09T08:00:00Z');

afterEach(() => vi.restoreAllMocks());

describe('DPD app session store', () => {
  it('loads and saves the sessions through the database', async () => {
    const sessions = [{ token: 'U1lOVEhFVElDX1NFU1NJT04=', openedAt: OPENED }];
    const client = { dpdAppSessions: vi.fn().mockResolvedValue(sessions), saveDpdAppSession: vi.fn().mockResolvedValue(undefined) };
    const logged = vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    const store = dpdSessionStore(client);
    await expect(store.load()).resolves.toBe(sessions);
    await store.save({ token: 'U1lOVEhFVElDX1NFU1NJT04=', openedAt: OPENED, checkedAt: OPENED + HOUR });
    expect(client.saveDpdAppSession).toHaveBeenCalledWith({ token: 'U1lOVEhFVElDX1NFU1NJT04=', openedAt: OPENED, checkedAt: OPENED + HOUR });
    expect(logged).not.toHaveBeenCalled();
  });

  it('logs how long DPD accepted a session it refuses, without its token', async () => {
    const client = { dpdAppSessions: vi.fn(), saveDpdAppSession: vi.fn().mockResolvedValue(undefined) };
    const logged = vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    await dpdSessionStore(client).save({ token: 'U1lOVEhFVElDX1NFU1NJT04=', openedAt: OPENED, checkedAt: OPENED + 20 * HOUR, refusedAt: OPENED + 21 * HOUR });
    expect(logged).toHaveBeenCalledWith('dpd_app_session_refused', { accepted_ms: 21 * HOUR, last_accepted_ms: 20 * HOUR });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('U1lOVEhF');
  });

  it('logs a failing database and lets the scraper carry on without it', async () => {
    const client = { dpdAppSessions: vi.fn().mockRejectedValue(new TypeError('fetch failed')), saveDpdAppSession: vi.fn().mockRejectedValue(new Error('Unavailable')) };
    const logged = vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    const store = dpdSessionStore(client);
    await expect(store.load()).rejects.toThrow('fetch failed');
    await expect(store.save({ token: 'U1lOVEhFVElDX1NFU1NJT04=', openedAt: OPENED })).rejects.toThrow('Unavailable');
    expect(logged.mock.calls).toEqual([
      ['dpd_app_session_store_failed', { operation: 'load', error_type: 'TypeError' }, 'warning'],
      ['dpd_app_session_store_failed', { operation: 'save', error_type: 'Error' }, 'warning'],
    ]);
  });
});
