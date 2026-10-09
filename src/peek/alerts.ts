import type { Locale } from '../i18n';
import { decodePublicKey } from '../lib/pushNotifications';
import { uid } from '../lib/uid';
import { linkNote, notedAlerts, noteLink, type DeviceAlert } from './deviceNotes';
import { ParcelLinkError, removeParcelAlert, setParcelAlert, type ParcelAlertPreset, type ParcelAlerts } from './links';
import { recentFor } from './recents';

/**
 * "Notify me" without an account: this browser's notifications for one parcel
 * link. Nothing is asked of the browser before someone chooses "Turn on".
 *
 * - `ready`: the browser can be asked.
 * - `install`: an iPhone or iPad outside a Home Screen app, where Safari sends none.
 * - `blocked`: notifications were refused for this site.
 * - `unsupported`: this browser has no notifications.
 * - `unavailable`: this server sends none.
 */
export type AlertSupport = 'ready' | 'install' | 'blocked' | 'unsupported' | 'unavailable';

/** Why turning alerts on stopped short of the server. A refused request reaches the caller as its `ParcelLinkError`. */
export class AlertError extends Error {
  constructor(readonly kind: 'blocked' | 'dismissed' | 'unsupported' | 'failed', cause?: unknown) {
    super(`Parcel alert: ${kind}`, { cause });
    this.name = 'AlertError';
  }
}

/** How long the page waits for its service worker before saying this browser cannot be reached. */
const WORKER_READY_MS = 8_000;
/** A demo alert's address: no push service stands behind it. */
const LOCAL_ENDPOINT = 'demo:';

/** As the account's notification settings tell it: iOS only delivers Web Push to a site on the Home Screen. */
function needsInstallation(): boolean {
  return (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
    && !window.matchMedia?.('(display-mode: standalone)').matches
    && !(navigator as Navigator & { standalone?: boolean }).standalone;
}

const hasNotifications = () => typeof window.Notification !== 'undefined';
const hasPush = () => 'serviceWorker' in navigator && typeof window.PushManager !== 'undefined';

/** What this browser can do about alerts for a link, without asking it anything. */
export function alertSupport(alerts: ParcelAlerts | undefined): AlertSupport {
  if (!alerts?.available) return 'unavailable';
  if (needsInstallation()) return 'install';
  // A link without a push key is the device demo's: its alerts never leave the browser.
  if (!hasNotifications() || (alerts.vapidPublicKey && !hasPush())) return 'unsupported';
  return Notification.permission === 'denied' ? 'blocked' : 'ready';
}

async function worker(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AlertError('unsupported')), WORKER_READY_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function pushKeys(subscription: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new AlertError('failed');
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/**
 * The alert this browser still has on the link, or null. A browser that
 * withdrew its permission or lost its push subscription has none, whatever it
 * noted earlier.
 */
export async function deviceAlert(linkId: string): Promise<DeviceAlert | null> {
  const noted = linkNote(linkId).alert;
  if (!noted) return null;
  let live = hasNotifications() && Notification.permission === 'granted';
  if (live && !noted.endpoint.startsWith(LOCAL_ENDPOINT)) {
    try {
      const registration = hasPush() ? await navigator.serviceWorker.getRegistration() : undefined;
      live = (await registration?.pushManager.getSubscription())?.endpoint === noted.endpoint;
    } catch {
      live = false;
    }
  }
  if (!live) noteLink(linkId, { alert: null });
  return live ? noted : null;
}

/**
 * Turns this browser's alerts on for a link, or changes what they announce.
 * This is the one place that asks for the notification permission and creates
 * a push subscription. The browser's subscription is shared with every other
 * parcel and with a signed-in account, so an existing one is reused.
 */
export async function turnOnAlert({ linkId, key, alerts, preset, locale }: {
  linkId: string;
  /** The owner key, when this device holds it: an owner's alert outlives a stop of the sharing. */
  key?: string | null;
  alerts: ParcelAlerts | undefined;
  preset: ParcelAlertPreset;
  locale: Locale;
}): Promise<DeviceAlert> {
  const support = alertSupport(alerts);
  if (support === 'blocked') throw new AlertError('blocked');
  if (support !== 'ready') throw new AlertError('unsupported');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new AlertError(permission === 'denied' ? 'blocked' : 'dismissed');

  let subscription: PushSubscription | null = null;
  let created = false;
  let address: { endpoint: string; keys: { p256dh: string; auth: string } };
  if (alerts!.vapidPublicKey) {
    const registration = await worker();
    try {
      subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePublicKey(alerts!.vapidPublicKey) });
        created = true;
      }
    } catch (error) {
      throw new AlertError('failed', error);
    }
    address = pushKeys(subscription);
  } else {
    const noted = linkNote(linkId).alert?.endpoint;
    address = { endpoint: noted?.startsWith(LOCAL_ENDPOINT) ? noted : `${LOCAL_ENDPOINT}${uid()}`, keys: { p256dh: 'demo', auth: 'demo' } };
  }

  try {
    await setParcelAlert(linkId, { subscription: address, preset, locale }, key);
  } catch (error) {
    // A subscription made for this alert alone does not outlive its refusal.
    if (created) await subscription?.unsubscribe().catch(() => false);
    throw error;
  }
  const alert = { preset, endpoint: address.endpoint, locale };
  noteLink(linkId, { alert });
  return alert;
}

/** Refusals that hold for as long as the link does: the alert has nothing to update, and is not tried again. */
const SETTLED: readonly string[] = ['unavailable', 'stopped', 'full', 'validation'];

/**
 * Gives this browser's alerts on parcel links the app's language, which the
 * server writes them in, as when the reader turned them on. It asks the
 * browser for nothing, and the server only about an alert last given another
 * language that this browser still receives. One link at a time; a failure
 * leaves the rest for the next start or change of language.
 */
export async function followAlertLanguage(locale: Locale): Promise<void> {
  const stale = () => notedAlerts().filter(([, alert]) => alert.locale !== locale && !alert.endpoint.startsWith(LOCAL_ENDPOINT));
  if (stale().length === 0 || !hasNotifications() || Notification.permission !== 'granted' || !hasPush()) return;
  const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!subscription) return;
  const address = pushKeys(subscription);
  for (const [linkId] of stale()) {
    // Read as it is now: the reader may have changed or turned off the alert while an earlier link was asked.
    const alert = linkNote(linkId).alert;
    // An alert on another subscription no longer reaches this browser: the parcel page forgets it.
    if (!alert || alert.locale === locale || alert.endpoint !== address.endpoint) continue;
    try {
      await setParcelAlert(linkId, { subscription: address, preset: alert.preset, locale }, recentFor(linkId)?.key);
    } catch (error) {
      if (!(error instanceof ParcelLinkError) || !SETTLED.includes(error.kind)) throw error;
    }
    const current = linkNote(linkId).alert;
    if (current?.endpoint === alert.endpoint) noteLink(linkId, { alert: { ...current, locale } });
  }
}

/**
 * Turns this browser's alerts off for a link. The browser's push subscription
 * stays: other parcels and a signed-in account may be using it.
 */
export async function turnOffAlert(linkId: string): Promise<void> {
  const noted = linkNote(linkId).alert;
  if (!noted) return;
  await removeParcelAlert(linkId, noted.endpoint);
  noteLink(linkId, { alert: null });
}
