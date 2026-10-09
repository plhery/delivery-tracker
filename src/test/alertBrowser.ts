import { vi } from 'vitest';

type Permission = 'default' | 'granted' | 'denied';

/** A push address no push service knows. */
export const TEST_PUSH_ENDPOINT = 'https://push.example.test/send/abc';
/** A VAPID public key's shape, made of nothing. */
export const TEST_PUSH_KEY = `B${'A'.repeat(86)}`;
export const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
/** Safari 27, whose bar keeps Share inside its page menu. */
export const IPHONE_SAFARI_27 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
/** Chrome on iPhone, whose Share button sits in its address bar. */
export const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1';
/** LinkedIn's own browser, which can put nothing on the Home Screen but lets a page out to Safari. */
export const IPHONE_LINKEDIN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.31.1';
/** Facebook's own browser, which lets a page out to Safari only through a window opened on a tap. */
export const IPHONE_FACEBOOK = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/530.0.0.47.106;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/26.0;FBLC/en_US]';
/** X's own browser, which lets no page out. */
export const IPHONE_X = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/11.20';

/**
 * A browser's notifications and push as a test sees them: what it allows,
 * what the person answers when asked, and whether it already holds a push
 * subscription. Undo with `restoreAlertBrowser`.
 */
export function stubAlertBrowser({ permission = 'default', answer = 'granted', existing = false, ready = true, userAgent }: {
  permission?: Permission;
  /** What the person answers when asked. */
  answer?: Permission;
  /** The browser already has a push subscription, as from a signed-in account. */
  existing?: boolean;
  /** Whether the page's service worker ever gets ready. */
  ready?: boolean;
  userAgent?: string;
} = {}) {
  const state = { permission };
  const subscription = {
    endpoint: TEST_PUSH_ENDPOINT,
    toJSON: () => ({ endpoint: TEST_PUSH_ENDPOINT, expirationTime: null, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }),
    unsubscribe: vi.fn(async () => true),
  };
  let current: typeof subscription | null = existing ? subscription : null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => { current = subscription; return subscription; }),
  };
  const requestPermission = vi.fn(async () => { state.permission = answer; return answer; });
  vi.stubGlobal('Notification', { get permission() { return state.permission; }, requestPermission });
  vi.stubGlobal('PushManager', function PushManager() { /* The browser has one. */ });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: ready ? Promise.resolve({ pushManager }) : new Promise(() => undefined), getRegistration: vi.fn(async () => ({ pushManager })) },
  });
  if (userAgent) vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  return { state, subscription, pushManager, requestPermission, drop: () => { current = null; } };
}

export function restoreAlertBrowser(): void {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'standalone');
}
