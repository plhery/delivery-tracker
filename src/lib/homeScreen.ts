/**
 * How an iPhone browser reaches "Add to Home Screen".
 *
 * - `menu`: Safari 27 on iPhone, whose bar has no Share button. Share sits in
 *   the page menu of the address bar, and "Add to Home Screen" behind "View More".
 * - `bar`: Chrome and Firefox, whose Share button sits in the address bar.
 * - `share`: every other browser and version, which shows a Share button.
 * - `safari`: an app's own browser, as Instagram or LinkedIn open links in.
 *   It has no way to the Home Screen: the page has to open in Safari first.
 */
export type HomeScreenPath = 'menu' | 'bar' | 'share' | 'safari';

const APPLE = /iPhone|iPad|iPod|Macintosh/;
/** Other iPhone browsers also say "Safari" and may carry a `Version/`; their own token tells them apart. */
const OTHER_BROWSER = /(CriOS|FxiOS|EdgiOS|OPiOS|OPT|DuckDuckGo)\//;
/** Browsers whose Share button sits in the address bar. */
const BAR_BROWSER = /(CriOS|FxiOS)\//;
/**
 * Apps that open links in their own browser and name themselves in its user
 * agent. An app that does not still leaves Safari's own token out, but Meta's
 * apps and the Google app keep it.
 */
const APP_BROWSER = /\b(Instagram|FBAN|FBAV|FB_IAB|IABMV|Barcelona|musical_ly|Bytedance|trill_|Snapchat|LinkedInApp|Twitter|Line\/|MicroMessenger|GSA\/|WAiOS|Reddit\/|Pinterest|KAKAOTALK|NAVER\()/;
/** Apps known to let no page out to Safari, whatever it asks. */
const CLOSED_APP = /\b(Twitter|musical_ly|Bytedance|trill_|MicroMessenger|Snapchat)/;
/** Meta's apps, which only let a page out through a window it opens on a tap. */
const META_APP = /\b(FBAN|FBAV|FB_IAB|IABMV|Barcelona)/;

const agent = () => typeof navigator === 'undefined' ? '' : navigator.userAgent;
/** Telegram's browser says it is Safari, word for word; only its page bridge tells it apart. */
const inTelegram = () => typeof window !== 'undefined' && 'TelegramWebviewProxy' in window;

export function homeScreenPath(userAgent: string = agent(), telegram: boolean = inTelegram()): HomeScreenPath {
  if (APPLE.test(userAgent) && (APP_BROWSER.test(userAgent) || telegram || (/AppleWebKit\//.test(userAgent) && !/Safari\//.test(userAgent)))) return 'safari';
  if (BAR_BROWSER.test(userAgent)) return 'bar';
  if (!/iPhone/.test(userAgent) || !/Safari\//.test(userAgent) || OTHER_BROWSER.test(userAgent)) return 'share';
  const version = /Version\/(\d+)/.exec(userAgent);
  return version && Number(version[1]) >= 27 ? 'menu' : 'share';
}

/**
 * How a tap takes this page from an app's browser to Safari, or null where
 * the app lets nothing out and the link has to be copied. `window` is for
 * apps that follow no link to Safari, but do open a window on a tap.
 */
export function safariHandoff(page: string, userAgent: string = agent()): { href: string; window: boolean } | null {
  if (CLOSED_APP.test(userAgent)) return null;
  // Instagram stopped letting Safari's own address through in 2026; its own one still opens the default browser.
  if (/\bInstagram\b/.test(userAgent) && !/\bBarcelona\b/.test(userAgent)) return { href: `instagram://extbrowser/?url=${encodeURIComponent(page)}`, window: false };
  if (/\bKAKAOTALK\b/.test(userAgent)) return { href: `kakaotalk://web/openExternal?url=${encodeURIComponent(page)}`, window: false };
  if (!/^https?:/.test(page)) return null;
  return { href: `x-safari-${page}`, window: META_APP.test(userAgent) };
}
