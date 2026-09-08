import catalog from '../../shared/analytics.json';

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

export const analyticsPreferenceKey = 'sdt.analytics.enabled';
export function analyticsEnabled() {
  try { return localStorage.getItem(analyticsPreferenceKey) !== 'false'; } catch { return false; }
}
export function setAnalyticsEnabled(enabled: boolean) {
  try { localStorage.setItem(analyticsPreferenceKey, String(enabled)); } catch { return; }
  if (!enabled) { queue = []; cache = undefined; }
  else { startup = undefined; disabled = false; lastView = ''; void startAnalytics().then(() => trackScreen(screen)); }
}
function optedOut() {
  try {
    return !analyticsEnabled() || navigator.doNotTrack === '1'
      || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
      || localStorage.getItem('umami.disabled') === '1';
  } catch { return true; }
}

export function startAnalytics(): Promise<void> {
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
      if (queue.length < 30) queue.push({ screen, mode, name: 'app-open' });
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
      try {
        const response = await fetch(config.endpoint, {
          method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
          signal: AbortSignal.timeout(5_000),
          headers: { 'Content-Type': 'application/json', ...(cache ? { 'x-umami-cache': cache } : {}) },
          body: JSON.stringify({ type: 'event', payload: {
            website: config.webWebsite, hostname: config.hostname, url: `/${event.screen}`, title: event.screen,
            language: navigator.language, screen: `${window.screen.width}x${window.screen.height}`,
            ...(event.name ? { name: event.name } : {}),
            data: { platform: window.matchMedia?.('(display-mode: standalone)').matches ? 'pwa' : 'web',
              mode: event.mode, ...(event.outcome ? { outcome: event.outcome } : {}) },
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

export function trackScreen(next: string, nextMode: Event['mode'] = mode) {
  if (!catalog.screens.includes(next)) return;
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
