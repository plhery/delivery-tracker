'use client';

import './cascade';
import { startAnalytics } from './lib/analytics';
import { useEffect, useMemo } from 'react';
import { accountCode } from './accountCode';
import { ApiApplication } from './ApiApplication';
import { AuthProvider } from './auth/AuthContext';
import { authConfigFromEnvironment } from './auth/authConfig';
import { I18nProvider, useI18n, type Locale, type Messages } from './i18n';
import { isDemoBuild } from './lib/buildMode';
import { enableAppBadgeClearing } from './lib/pushNotifications';
import { checkForUpdatesOnResume, enablePwaLiveReload, registerPwaServiceWorker } from './lib/pwaUpdates';
import { createDemoRepo } from './store/demoRepo';
import { AppearanceProvider } from './lib/appearance';
import { useEntryHint } from './lib/entryHint';
import { useDemoAddress, useEntryExperience } from './lib/experience';
import { MovedHost } from './lib/movedHost';
import { ParcelIllustration } from './components/Icon';
import { usePendingInvitation } from './lib/friendInvites';
import { PeekRoot } from './peek/PeekRoot';
import { useLandingRoute, useParcelLinkRoute } from './peek/route';
import { useVisitorSession } from './peek/visitor';
import type { ParcelRepo } from './types';

export { shouldUseDemoRepository } from './lib/buildMode';

const authConfig = authConfigFromEnvironment({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  googleEnabled: process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED,
  appleEnabled: process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED,
  emailOtpEnabled: process.env.NEXT_PUBLIC_AUTH_EMAIL_OTP_ENABLED,
});

interface ApplicationProps {
  invitationRoute?: boolean;
  /** The link id of the parcel page the server rendered, at `/p/<id>`. */
  parcelLinkId?: string | null;
  /** The server rendered the demo's address, `/demo`. */
  demoRoute?: boolean;
  /** The server rendered one of the landing's own addresses: `/home`, or a language's such as `/de`. */
  landingRoute?: boolean;
  /** The server has mail settings: it emails accounts when a parcel is delivered. */
  deliveryEmails?: boolean;
  initialLocale?: Locale;
  initialMessages?: Messages;
}

export function ClientApplication({ movedTo, ...props }: ApplicationProps & {
  /** The origin the site moved to, when the server rendered the page on a host it has left. */
  movedTo?: string;
}) {
  // On a host the site has left, nothing of the app starts until it is known to stay there.
  return movedTo ? <MovedHost to={movedTo}><Application {...props} /></MovedHost> : <Application {...props} />;
}

function Application({ invitationRoute = false, parcelLinkId = null, demoRoute = false, landingRoute = false, deliveryEmails = false, initialLocale, initialMessages }: ApplicationProps) {
  // A browser that will open on the account's screens comes alive with their code in hand.
  accountCode.useEarly();
  const demoRepo = useMemo(
    () => isDemoBuild ? createDemoRepo() : null,
    [],
  );

  useEffect(() => {
    void startAnalytics();
    const disableReload = enablePwaLiveReload();
    let disposed = false;
    let disableUpdateChecks = () => {};
    if (process.env.NODE_ENV === 'production') {
      void registerPwaServiceWorker().then((registration) => {
        if (registration && !disposed) disableUpdateChecks = checkForUpdatesOnResume(registration);
      }).catch(() => undefined);
    }
    const disableBadgeClearing = enableAppBadgeClearing();
    return () => {
      disposed = true;
      disableReload();
      disableUpdateChecks();
      disableBadgeClearing();
    };
  }, []);

  return (
    <I18nProvider initialLocale={initialLocale} initialMessages={initialMessages}>
      <AppearanceProvider>
      {demoRepo ? <DemoApplication repo={demoRepo} invitationRoute={invitationRoute} parcelLinkId={parcelLinkId} demoRoute={demoRoute} landingRoute={landingRoute} /> : (
        <AuthProvider config={authConfig}>
          <ApiApplication invitationRoute={invitationRoute} parcelLinkId={parcelLinkId} demoRoute={demoRoute} landingRoute={landingRoute} deliveryEmails={deliveryEmails} />
        </AuthProvider>
      )}
      </AppearanceProvider>
    </I18nProvider>
  );
}

/** A build without an API: everyone is a visitor, and the demo stands in for an account. */
export function DemoApplication({ repo, invitationRoute = false, parcelLinkId = null, demoRoute = false, landingRoute = false }: {
  repo: ParcelRepo;
  invitationRoute?: boolean;
  parcelLinkId?: string | null;
  demoRoute?: boolean;
  landingRoute?: boolean;
}) {
  const { t } = useI18n();
  const invitation = usePendingInvitation(invitationRoute);
  const experience = useEntryExperience(demoRoute);
  const demoAddress = useDemoAddress(demoRoute);
  const linkId = useParcelLinkRoute(parcelLinkId);
  const landingAddress = useLandingRoute(landingRoute);
  const session = useVisitorSession('visitor');
  // Without accounts the page knows who is looking as soon as it is live.
  useEntryHint(true);
  // A parcel's address shows the parcel, and the landing's the landing, whatever this browser was doing before.
  const peek = Boolean(linkId || landingAddress || (!invitation.pending && experience.screen === 'welcome'));
  // The rest is the account's: an invitation, the demo deliveries, the sign-in step. Its code is fetched when one is about to show.
  const code = accountCode.useCode(!peek);

  if (peek) return <PeekRoot session={session} serverLinkId={parcelLinkId} />;
  if (!code) return <div className="auth-loading" role="status"><ParcelIllustration /><span>{t('auth.loading')}</span></div>;
  return <code.DemoAccount repo={repo} experience={experience} invitation={invitation} demoAddress={demoAddress} leaveSignIn={session.leaveSignIn} />;
}
