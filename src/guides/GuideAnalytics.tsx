'use client';

import { useEffect } from 'react';
import { startAnalytics, trackScreen } from '../lib/analytics';

/** Counts a visit to a guides page, under the page's own name. */
export function GuideAnalytics({ screen }: { screen: string }) {
  useEffect(() => {
    trackScreen(screen);
    void startAnalytics();
  }, [screen]);
  return null;
}
