import { useMemo } from 'react';
import { accountCode } from './accountCode';
import { useAuth } from './auth/AuthContext';
import { ParcelIllustration } from './components/Icon';
import { useEntryHint } from './lib/entryHint';
import { useDemoAddress, useEntryExperience } from './lib/experience';
import { useI18n } from './i18n';
import { usePendingInvitation } from './lib/friendInvites';
import { PeekRoot } from './peek/PeekRoot';
import { useLandingRoute, useParcelLinkRoute } from './peek/route';
import type { PeekSession } from './peek/session';
import { useVisitorSession } from './peek/visitor';

export function ApiApplication({ invitationRoute = false, parcelLinkId = null, demoRoute = false, landingRoute = false, deliveryEmails = false }: {
  invitationRoute?: boolean;
  /** The link id of the parcel page the server rendered, at `/p/<id>`. */
  parcelLinkId?: string | null;
  /** The server rendered the demo's address, `/demo`. */
  demoRoute?: boolean;
  /** The server rendered one of the landing's own addresses: `/home`, or a language's such as `/de`. */
  landingRoute?: boolean;
  /** The server emails accounts when a parcel is delivered: the landing says so. */
  deliveryEmails?: boolean;
}) {
  const { t } = useI18n();
  const auth = useAuth();
  const experience = useEntryExperience(demoRoute);
  const demoAddress = useDemoAddress(demoRoute);
  const invitation = usePendingInvitation(invitationRoute);
  const linkId = useParcelLinkRoute(parcelLinkId);
  const landingAddress = useLandingRoute(landingRoute);
  // The demo's address shows the demo to anyone at once, a parcel's the parcel, the landing's the landing; elsewhere the
  // landing is a visitor's first screen. Everything else is the account's: its code is fetched when it is about to show.
  const landingFor = (restoring: boolean) => landingAddress || (!linkId && !invitation.pending && experience.screen === 'welcome' && !restoring);
  const code = accountCode.useCode(demoAddress || auth.status === 'authenticated' || !(linkId || landingFor(false)));
  // Someone signed in whose screens are still on their way waits as while the sign-in was being restored.
  const status = auth.status === 'authenticated' && !code ? 'loading' : auth.status;
  const visitor = useVisitorSession(status === 'loading' ? 'checking' : 'visitor');
  // A browser that holds a sign-in says so before the first paint: it waits for its deliveries, not at the landing.
  const restoring = useEntryHint(status !== 'loading') === 'app';
  // On a parcel page a visitor signs in without leaving it; the ways to do so come from here.
  const visitorSession = useMemo<PeekSession>(() => ({
    ...visitor,
    signInWith: {
      configured: auth.status !== 'unconfigured', googleEnabled: auth.googleEnabled, appleEnabled: auth.appleEnabled, emailOtpEnabled: auth.emailOtpEnabled,
      signInWithGoogle: auth.signInWithGoogle, signInWithApple: auth.signInWithApple, sendCode: auth.sendCode, verifyCode: auth.verifyCode,
    },
    deliveryEmails,
  }), [visitor, deliveryEmails, auth.status, auth.googleEnabled, auth.appleEnabled, auth.emailOtpEnabled, auth.signInWithGoogle, auth.signInWithApple, auth.sendCode, auth.verifyCode]);
  const waiting = <div className="auth-loading" role="status"><ParcelIllustration /><span>{t('auth.loading')}</span></div>;
  if (!demoAddress) {
    // A parcel's address shows the parcel to anyone at once, while a saved sign-in is still being restored.
    // Without one, a visitor arrives at the front door: the server draws it for everyone, since it cannot see a saved
    // sign-in, and so does a browser that holds none while it makes sure.
    // The landing's own address shows it to anyone at once, like a parcel's.
    const landing = landingFor(status === 'loading' && restoring);
    if (status !== 'authenticated' && (linkId || landing)) {
      return <>
        <PeekRoot session={visitorSession} serverLinkId={parcelLinkId} />
        {/* For the browser that does hold a sign-in: what it shows, in place of the landing, until the page is live. */}
        {landing && !landingAddress && status === 'loading' && <div className="auth-loading entry-splash" aria-hidden="true"><ParcelIllustration /><span>{t('auth.loading')}</span></div>}
      </>;
    }
    if (status === 'loading') return waiting;
  }
  if (!code) return waiting;
  return <code.ApiAccount auth={auth} experience={experience} invitation={invitation} demoAddress={demoAddress} linkId={linkId}
    landingAddress={landingAddress} parcelLinkId={parcelLinkId} leaveSignIn={visitor.leaveSignIn} />;
}
