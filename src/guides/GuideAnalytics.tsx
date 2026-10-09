'use client';

import { useEffect } from 'react';
import { holdsSignIn } from '../auth/savedSignIn';
import { startAnalytics, trackScreen } from '../lib/analytics';

/**
 * Counts a visit to a guides page, under the page's own name. Reading a guide
 * is not opening the app, so it counts no app open. A reader with a sign-in
 * saved in this browser counts as an account, as the app would count them,
 * without asking the server.
 */
export function GuideAnalytics({ screen }: { screen: string }) {
  useEffect(() => {
    trackScreen(screen, holdsSignIn() ? 'account' : 'anonymous');
    void startAnalytics({ open: false });
  }, [screen]);
  return null;
}
