import { useEffect, useRef } from 'react';
import { useI18n, type Locale } from '../i18n';

/** How long the app's language holds before it is sent: a saved choice replaces the first render's meanwhile. */
export const LANGUAGE_SETTLES_MS = 1_000;

/**
 * Hands the app's language to `follow` once the page is live and whenever it
 * changes, for what the server writes in it: browser alerts. One at a time, so
 * a slow request never puts back an older language; a change made while one
 * waits replaces it. `follow` decides whether there is anything to send.
 */
export function useFollowLanguage(follow: ((locale: Locale) => Promise<void>) | undefined): void {
  const { locale } = useI18n();
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    if (!follow) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      queue.current = queue.current.then(() => cancelled ? undefined : follow(locale)).catch(() => undefined);
    }, LANGUAGE_SETTLES_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [follow, locale]);
}
