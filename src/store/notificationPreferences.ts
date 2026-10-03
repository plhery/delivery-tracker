import { useCallback, useSyncExternalStore } from 'react';
import type { ApiAuth } from '../lib/apiClient';
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
  type NotificationStage,
} from '../lib/pushNotifications';

/**
 * The account's notification preferences, shared by everything that shows
 * them: Settings, a parcel's alerts and the email offer. The deliveries read
 * them once per sign-in, and every save replaces the shared copy with the
 * server's answer.
 */
interface Session {
  preferences: NotificationPreferences | null;
  /** The read in flight, so the deliveries ask once however often they render. */
  reading: Promise<NotificationPreferences> | null;
  /** Counts the answers taken: a read that began before a save must not undo it. */
  revision: number;
  listeners: Set<() => void>;
}

// One entry per sign-in. Its signal outlives the token refreshes that replace the `ApiAuth` object.
const sessions = new WeakMap<object, Session>();

function sessionOf(auth: ApiAuth): Session {
  const key = auth.signal ?? auth;
  let session = sessions.get(key);
  if (!session) {
    session = { preferences: null, reading: null, revision: 0, listeners: new Set() };
    sessions.set(key, session);
  }
  return session;
}

function take(session: Session, preferences: NotificationPreferences): NotificationPreferences {
  session.preferences = preferences;
  session.revision += 1;
  for (const listener of [...session.listeners]) listener();
  return preferences;
}

/**
 * Reads the preferences from the server. Settings asks whenever it opens; the
 * deliveries ask with `once`, and get what this sign-in has already read.
 */
export function loadNotificationPreferences(auth: ApiAuth, { once = false } = {}): Promise<NotificationPreferences> {
  const session = sessionOf(auth);
  if (once && session.preferences) return Promise.resolve(session.preferences);
  if (once && session.reading) return session.reading;
  const { revision } = session;
  const reading = getNotificationPreferences(auth).then((preferences) => {
    // Something answered meanwhile, a save perhaps: that answer is the newer one.
    if (session.revision !== revision && session.preferences) return session.preferences;
    return take(session, preferences);
  }).finally(() => {
    if (session.reading === reading) session.reading = null;
  });
  session.reading = reading;
  return reading;
}

async function save(preferences: NotificationPreferences, auth: ApiAuth): Promise<NotificationPreferences> {
  return take(sessionOf(auth), await saveNotificationPreferences(preferences, auth));
}

/** The browser's time zone, which every save sends; the stored one where the browser names none. */
function timeZone(saved: NotificationPreferences | null): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || saved?.timezone || 'Europe/Zurich';
}

/**
 * Saves which events are announced. The retired quiet hours are cleared, and
 * the email choice is left out, so the server keeps it as it is.
 */
export function saveNotificationStages(stages: NotificationStage[], auth: ApiAuth): Promise<NotificationPreferences> {
  return save({
    enabledStages: stages,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: timeZone(sessionOf(auth).preferences),
  }, auth);
}

/**
 * Switches the delivery email on or off, and nothing else: the events go as
 * they were last saved, not as a form may have them drafted.
 */
export function saveEmailOnDelivery(enabled: boolean, auth: ApiAuth): Promise<NotificationPreferences> {
  const saved = sessionOf(auth).preferences;
  if (!saved) return Promise.reject(new Error('Notification preferences are not loaded'));
  return save({
    enabledStages: saved.enabledStages,
    quietHoursStart: saved.quietHoursStart,
    quietHoursEnd: saved.quietHoursEnd,
    timezone: timeZone(saved),
    emailOnDelivery: enabled,
  }, auth);
}

/** The shared copy: null until this sign-in has read or saved them, and without an account. */
export function useNotificationPreferences(auth: ApiAuth | undefined): NotificationPreferences | null {
  const subscribe = useCallback((notify: () => void) => {
    if (!auth) return () => undefined;
    const { listeners } = sessionOf(auth);
    listeners.add(notify);
    return () => { listeners.delete(notify); };
  }, [auth]);
  return useSyncExternalStore(subscribe, () => auth ? sessionOf(auth).preferences : null, () => null);
}

/** The delivery email, as far as this account can have one. */
export interface DeliveryEmail {
  /** Where it goes: the address the account signs in with. */
  address: string;
  /** True on, false off or declined, null never chosen. */
  choice: boolean | null;
}

/**
 * The delivery email of the signed-in account, or null where nothing about
 * email may show: the server sends none or cannot write to this account, the
 * preferences are not read yet, or the session names no address.
 */
export function useDeliveryEmail(auth: ApiAuth | undefined, address: string | undefined): DeliveryEmail | null {
  const preferences = useNotificationPreferences(auth);
  if (preferences?.emailAvailable !== true || !address?.includes('@')) return null;
  // Only the server's explicit null means "never chosen", which is what the one-time offer waits for.
  return { address, choice: preferences.emailOnDelivery === undefined ? false : preferences.emailOnDelivery };
}
