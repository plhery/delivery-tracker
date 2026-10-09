import catalog from '../../shared/analytics.json';
import { isLocale, SUPPORTED_LOCALES } from './locale';

export type AnalyticsOutcome = 'success' | 'error' | 'started' | 'accepted';
type Configuration = { endpoint: string; hostname: string; webWebsite: string; iosWebsite: string };
type Event = { screen: string; name?: string; outcome?: AnalyticsOutcome; mode: 'demo' | 'account' | 'anonymous' };
let config: Configuration | null = null;
let startup: Promise<void> | undefined;
let screen = 'welcome';
let mode: Event['mode'] = 'anonymous';
let lastView = '';
let cache: string | undefined;
let queue: Event[] = [];
let sending = false;
let disabled = false;

/** The campaign keys a landing address may carry to analytics. Any other query can hold a tracking number, and stays. */
const CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

/**
 * The site that linked to this page, as its origin and path, or nothing when it is this
 * site or none. Its query and fragment are its own business. An Android app that opened
 * the page names itself as `android-app://<package>/`.
 */
function outsideReferrer(referrer: string, hostname: string): string | undefined {
  try {
    const from = new URL(referrer);
    if (!['http:', 'https:', 'android-app:'].includes(from.protocol) || !from.host) return undefined;
    const site = (host: string) => host.toLowerCase().replace(/^www\./, '');
    if (site(from.hostname) === site(hostname)) return undefined;
    return `${from.protocol}//${from.host}${from.pathname}`;
  } catch { return undefined; }
}

/** The landing address's campaign, as a query Umami reads: only the campaign keys, each shortened. */
function campaignQuery(search: string): string {
  const given = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of CAMPAIGN_KEYS) {
    const value = given.get(key)?.trim().slice(0, 100);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : '';
}

/**
 * Where this page load came from, read once as the page starts, before the app can
 * change its address. Umami counts sources from page views alone, so it rides on the
 * load's first view.
 */
let arrival: { referrer?: string; campaign: string } | null = typeof window === 'undefined' ? null
  : { referrer: outsideReferrer(document.referrer, location.hostname), campaign: campaignQuery(location.search) };

/** The app's language as the page declares it (`pt-PT` is `pt`), when it is one Peek speaks. */
function appLocale(): string | undefined {
  const language = document.documentElement.lang.toLowerCase().split('-')[0];
  return isLocale(language) ? language : undefined;
}

export const analyticsPreferenceKey = 'sdt.analytics.enabled';
export function analyticsEnabled() {
  try { return localStorage.getItem(analyticsPreferenceKey) !== 'false'; } catch { return false; }
}
export function setAnalyticsEnabled(enabled: boolean) {
  try { localStorage.setItem(analyticsPreferenceKey, String(enabled)); } catch { return; }
  if (!enabled) { queue = []; cache = undefined; }
  else { startup = undefined; disabled = false; lastView = ''; void startAnalytics().then(() => trackScreen(screen)); }
}
/**
 * Nothing is counted for a reader who asked not to be, nor for a browser driven by a program
 * (a headless crawler, a test run): it is no visitor. This decides only what is counted; the
 * page reads and draws the same for everyone.
 */
function optedOut() {
  try {
    return !analyticsEnabled() || navigator.doNotTrack === '1'
      || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
      || navigator.webdriver === true
      || localStorage.getItem('umami.disabled') === '1';
  } catch { return true; }
}

/** Starts collection once per page load. `open: false` is a page that is not the app, a guide: its load is no app open. */
export function startAnalytics({ open = true }: { open?: boolean } = {}): Promise<void> {
  if (typeof window === 'undefined' || optedOut()) return Promise.resolve();
  return startup ??= (async () => {
    try {
      const response = await fetch('/api/analytics/config', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5_000) });
      const value = response.ok ? await response.json() as Configuration | null : null;
      if (!value || value.hostname !== location.hostname || location.protocol !== 'https:') return;
      const endpoint = new URL(value.endpoint);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/api/send'
        || endpoint.search || endpoint.hash || !/^[0-9a-f-]{36}$/i.test(value.webWebsite)) return;
      config = value;
      if (open && queue.length < 30) queue.push({ screen, mode, name: 'app-open' });
    } catch { /* Analytics must never affect the app. */ }
    finally { if (!config) { disabled = true; queue = []; } else void flush(); }
  })();
}

function enqueue(event: Event) {
  if (typeof window === 'undefined' || optedOut()) return;
  // Only queue during initialization; do not accumulate while disabled or offline.
  if (disabled || queue.length >= 30) return;
  queue.push(event);
  void flush();
}

async function flush() {
  if (sending || !config) return;
  sending = true;
  try {
    while (queue.length && config) {
      const event = queue.shift()!;
      if (optedOut()) { queue = []; break; }
      const source = !event.name ? arrival : null;
      if (source) arrival = null;
      const locale = appLocale();
      try {
        const response = await fetch(config.endpoint, {
          method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
          signal: AbortSignal.timeout(5_000),
          headers: { 'Content-Type': 'application/json', ...(cache ? { 'x-umami-cache': cache } : {}) },
          body: JSON.stringify({ type: 'event', payload: {
            website: config.webWebsite, hostname: config.hostname, url: `/${event.screen}${source?.campaign ?? ''}`, title: event.screen,
            ...(source?.referrer ? { referrer: source.referrer } : {}),
            language: navigator.language, screen: `${window.screen.width}x${window.screen.height}`,
            ...(event.name ? { name: event.name } : {}),
            data: { platform: window.matchMedia?.('(display-mode: standalone)').matches ? 'pwa' : 'web',
              mode: event.mode, ...(locale ? { locale } : {}), ...(event.outcome ? { outcome: event.outcome } : {}) },
          } }),
        });
        if (response.ok) {
          const result = await response.json() as { cache?: unknown };
          if (typeof result.cache === 'string') cache = result.cache;
        }
      } catch { /* Drop failed events; no replay of stale/offline actions. */ }
    }
  } finally { sending = false; }
}

/** A guides page counts under its language and the guide's id, never its address: `guides/fr`, `guides/fr/<id>`. */
const GUIDE_SCREEN = new RegExp(`^guides/(?:${SUPPORTED_LOCALES.join('|')})(?:/[a-z0-9]+(?:-[a-z0-9]+)*)?$`);

export function trackScreen(next: string, nextMode: Event['mode'] = mode) {
  if (!catalog.screens.includes(next) && !GUIDE_SCREEN.test(next)) return;
  screen = next; mode = nextMode;
  const key = `${nextMode}:${next}`;
  if (lastView === key) return;
  lastView = key;
  enqueue({ screen, mode });
}

export function trackAction(name: string, outcome?: AnalyticsOutcome) {
  if (!catalog.actions.includes(name)) return;
  enqueue({ screen, mode, name, outcome });
}

/** Only fixed event names leave this mapper. Paths, IDs and request bodies never do. */
export function apiAnalyticsEvent(path: string, method = 'GET', body?: unknown): string | undefined {
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname === '/api/friends' && method === 'POST') {
    try {
      const value = typeof body === 'string' ? JSON.parse(body) : body;
      const action = value?.action;
      if (typeof action === 'string' && Object.hasOwn(catalog.friendActions, action))
        return catalog.friendActions[action as keyof typeof catalog.friendActions];
    } catch { /* Malformed requests are not analytics input. */ }
    return;
  }
  return catalog.operations.find((rule) => rule.method === method && new RegExp(rule.path).test(pathname))?.event;
}

export function trackOverlay(next: string) {
  const previous = screen;
  trackScreen(next);
  return () => { if (screen === next) trackScreen(previous); };
}
