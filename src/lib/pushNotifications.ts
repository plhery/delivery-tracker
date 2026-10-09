import { authenticatedFetch, type ApiAuth } from './apiClient';
import type { Locale } from '../i18n';
import type {
  ApiOkResponse,
  ApiNotificationPreferences,
  ApiNotificationStage,
  ApiPushConfigResponse,
  ApiPushSubscriptionResponse,
  ApiPushSubscriptionStatusResponse,
} from '../generated/apiContract';

export type NotificationPreferences = ApiNotificationPreferences;
export type NotificationStage = ApiNotificationStage;

export {
  ALL_NOTIFICATION_STAGES,
  DELIVERY_DAY_NOTIFICATION_STAGES,
  IMPORTANT_NOTIFICATION_STAGES,
} from './notificationPresets';

export type PushState =
  | { kind: 'unsupported' }
  | { kind: 'install' }
  | { kind: 'unavailable' }
  | { kind: 'prompt'; publicKey: string }
  | { kind: 'blocked' }
  | { kind: 'enabled'; publicKey: string };

type BadgeNavigator = { clearAppBadge?: () => Promise<void> };
type VisibilityDocument = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

/** Clear stale OS app badges on launch and whenever the PWA returns to the foreground. */
export function enableAppBadgeClearing(
  appNavigator: BadgeNavigator = navigator as BadgeNavigator,
  page: VisibilityDocument = document,
): () => void {
  const clearWhenVisible = () => {
    if (page.visibilityState !== 'visible') return;
    void appNavigator.clearAppBadge?.().catch(() => undefined);
  };

  clearWhenVisible();
  page.addEventListener('visibilitychange', clearWhenVisible);
  return () => page.removeEventListener('visibilitychange', clearWhenVisible);
}

async function request<T>(path: string, auth?: ApiAuth, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const response = await authenticatedFetch(path, auth, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || 'Notification settings are unavailable');
  return body as T;
}

function supported(): boolean {
  return (
    'serviceWorker' in navigator &&
    typeof window.PushManager !== 'undefined' &&
    typeof window.Notification !== 'undefined'
  );
}

/**
 * The language this browser's push subscription last gave an account, with the
 * subscription's address, so a start that changes nothing asks the server nothing.
 */
const sentLocaleKey = (userId: string) => `deliveryTrackerPushLocale:${userId}`;

function wasSent(userId: string, endpoint: string, locale: Locale): boolean {
  try {
    return localStorage.getItem(sentLocaleKey(userId)) === `${locale} ${endpoint}`;
  } catch {
    return false;
  }
}

function noteSent(userId: string, sent: { endpoint?: string; locale: Locale } | null): void {
  try {
    if (sent?.endpoint) localStorage.setItem(sentLocaleKey(userId), `${sent.locale} ${sent.endpoint}`);
    else localStorage.removeItem(sentLocaleKey(userId));
  } catch {
    // Without storage the language is sent again on the next start.
  }
}

export async function inspectPushState(auth?: ApiAuth): Promise<PushState> {
  const needsInstallation = (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
    && !window.matchMedia?.('(display-mode: standalone)').matches
    && !(navigator as Navigator & { standalone?: boolean }).standalone;
  if (!supported() && !needsInstallation) return { kind: 'unsupported' };
  const config = await request<ApiPushConfigResponse>('/api/push/config', auth);
  if (!config.available || !config.publicKey) return { kind: 'unavailable' };
  if (needsInstallation) return { kind: 'install' };
  if (Notification.permission === 'denied') return { kind: 'blocked' };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  // The browser keeps its subscription after the server removed or expired it,
  // so a signed-in device counts as enabled only while the server delivers to it.
  const active = subscription && (!auth || (await request<ApiPushSubscriptionStatusResponse>(
    '/api/push/subscriptions/status',
    auth,
    { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) },
  )).active);
  return active
    ? { kind: 'enabled', publicKey: config.publicKey }
    : { kind: 'prompt', publicKey: config.publicKey };
}

export async function getNotificationPreferences(
  auth: ApiAuth,
): Promise<NotificationPreferences> {
  return request<ApiNotificationPreferences>('/api/push/preferences', auth);
}

export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
  auth: ApiAuth,
): Promise<NotificationPreferences> {
  return request<ApiNotificationPreferences>('/api/push/preferences', auth, {
    method: 'PATCH',
    body: JSON.stringify(preferences),
  });
}

export async function enablePushNotifications(
  publicKey: string,
  auth?: ApiAuth,
  locale: Locale = 'en',
): Promise<boolean> {
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed');
  const registration = await navigator.serviceWorker.ready;
  const subscribe = () => registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodePublicKey(publicKey),
  });
  const register = async (subscription: PushSubscription, created: boolean) => {
    try {
      const result = await request<ApiPushSubscriptionResponse>('/api/push/subscriptions', auth, {
        method: 'POST',
        body: JSON.stringify({ ...subscription.toJSON(), locale }),
      });
      if (auth) noteSent(auth.userId, { endpoint: subscription.endpoint, locale });
      return result.testSent;
    } catch (error) {
      if (created) await subscription.unsubscribe();
      throw error;
    }
  };
  const existing = await registration.pushManager.getSubscription();
  if (!existing) return register(await subscribe(), true);
  if (await register(existing, false)) return true;
  // A kept subscription can be one the push service already dropped. Replace it
  // once rather than registering an endpoint that cannot receive alerts.
  await request<ApiOkResponse>('/api/push/subscriptions', auth, {
    method: 'DELETE',
    body: JSON.stringify({ endpoint: existing.endpoint }),
  }).catch(() => undefined);
  await existing.unsubscribe().catch(() => false);
  return register(await subscribe(), true);
}

/**
 * Gives the account's push subscription on this browser the app's language,
 * which the server writes its alerts in, without resetting the delivery cursor
 * or sending a welcome alert. It asks the browser for nothing, and the server
 * only when this subscription last gave the account another language: without
 * a permission and a subscription there is nothing to update.
 */
export async function followPushNotificationLocale(locale: Locale, auth: ApiAuth): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription || wasSent(auth.userId, subscription.endpoint, locale)) return;
  await request<ApiOkResponse>('/api/push/subscriptions', auth, {
    method: 'PATCH', body: JSON.stringify({ endpoint: subscription.endpoint, locale }),
  });
  noteSent(auth.userId, { endpoint: subscription.endpoint, locale });
}

export async function disablePushNotifications(auth?: ApiAuth): Promise<void> {
  if (auth) noteSent(auth.userId, null);
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await request<ApiOkResponse>('/api/push/subscriptions', auth, {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } finally {
    // Stop local delivery even if the server is temporarily unreachable. Its
    // next send will receive an expired-endpoint response and disable the row.
    await subscription.unsubscribe();
  }
}

export async function unsubscribePushNotificationsLocally(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

export function decodePublicKey(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = window.atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  return bytes.buffer;
}
