/**
 * How an iPhone browser reaches "Add to Home Screen".
 *
 * - `menu`: Safari 27 on iPhone, whose bar has no Share button. Share sits in
 *   the page menu of the address bar, and "Add to Home Screen" behind "View More".
 * - `share`: every other browser and version, which shows a Share button.
 */
export type HomeScreenPath = 'menu' | 'share';

/** Other iPhone browsers also say "Safari" and may carry a `Version/`; their own token tells them apart. */
const OTHER_BROWSER = /(CriOS|FxiOS|EdgiOS|OPiOS|OPT|DuckDuckGo|GSA)\//;

export function homeScreenPath(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): HomeScreenPath {
  if (!/iPhone/.test(userAgent) || !/Safari\//.test(userAgent) || OTHER_BROWSER.test(userAgent)) return 'share';
  const version = /Version\/(\d+)/.exec(userAgent);
  return version && Number(version[1]) >= 27 ? 'menu' : 'share';
}
