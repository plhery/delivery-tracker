import { useMemo } from 'react';
import { useEntryExperience, type EntryScreen } from '../lib/experience';
import { clearPendingKeep, rememberPendingKeep } from './pending';
import { leaveParcelLink, parcelLinkIdFromPath } from './route';
import type { PeekSession } from './session';

/**
 * The session of someone who is not signed in, for the app's entry points.
 * Signing in happens at `/`, where a sign-in provider returns to: a parcel
 * page is left for it, and the parcel to keep is noted for afterwards.
 */
export function useVisitorSession(account: 'checking' | 'visitor'): PeekSession & {
  /** The sign-in step's own navigation: going back abandons the parcel that was to be kept. */
  leaveSignIn(next: EntryScreen): void;
} {
  const { navigate } = useEntryExperience();
  return useMemo(() => ({
    account,
    signIn(keepLinkId?: string) {
      if (keepLinkId) rememberPendingKeep(keepLinkId);
      if (parcelLinkIdFromPath(window.location.pathname)) leaveParcelLink();
      navigate('sign-in');
    },
    leaveSignIn(next: EntryScreen) {
      if (next === 'welcome') clearPendingKeep();
      navigate(next);
    },
  }), [account, navigate]);
}
