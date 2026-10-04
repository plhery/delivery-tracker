import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { FrontDoor, type TrackedParcel } from './FrontDoor';
import type { ParcelLinkView } from './links';
import { parcelCode } from './parcelCode';
import { NoticeToast } from './parcel/Toast';
import { rememberParcel } from './recents';
import { openParcelLink, parcelLinkPath, useParcelLinkRoute } from './route';
import { SAMPLE_LINK_ID } from './sample';
import { PeekSessionProvider, type PeekSession } from './session';

type ViewTransitions = { startViewTransition?: (update: () => void) => unknown };

/**
 * What someone without an open deliveries app sees: the parcel page at
 * `/p/<id>`, the front door anywhere else. It owns the hand-over between the
 * two: when a lookup answers, the address becomes the parcel's own and the
 * page opens with that answer. The sample parcel is handed over the same way.
 */
export function PeekRoot({ session, serverLinkId = null }: {
  session: PeekSession;
  /** The link id the server rendered the page for. */
  serverLinkId?: string | null;
}) {
  const linkId = useParcelLinkRoute(serverLinkId);
  // The parcel page's code comes with a parcel's address. The door comes without it, and fetches it once it is live:
  // by the time a lookup answers, its page is ready.
  const screens = parcelCode.useCode(linkId !== null);
  useEffect(() => {
    const fetchScreens = () => { void parcelCode.load().catch(() => undefined); };
    if (typeof requestIdleCallback !== 'function') {
      const timer = setTimeout(fetchScreens, 1_000);
      return () => clearTimeout(timer);
    }
    const idle = requestIdleCallback(fetchScreens, { timeout: 3_000 });
    return () => cancelIdleCallback(idle);
  }, []);
  const [revealed, setRevealed] = useState<{ id: string; view: ParcelLinkView } | null>(null);
  // The reveal belongs to one arrival: coming back to the page later opens it like any link.
  if (revealed && revealed.id !== linkId) setRevealed(null);

  const reveal = useCallback((id: string, view: ParcelLinkView) => {
    const show = () => {
      setRevealed({ id, view });
      openParcelLink(id);
    };
    // The address and the answer change in one render, so the page mounts with its answer.
    const handOver = () => flushSync(show);
    const open = () => {
      const transitions = document as ViewTransitions;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (still || typeof transitions.startViewTransition !== 'function') handOver();
      // Pip keeps one transition name across both views, so the browser moves it from the door into the page.
      else transitions.startViewTransition(handOver);
    };
    // An answer that comes before the page's code waits for it. If the code cannot be fetched, the browser opens the
    // parcel's address itself.
    if (parcelCode.read()) open();
    else void parcelCode.load().then(open, () => window.location.assign(parcelLinkPath(id)));
  }, []);

  const onTracked = useCallback(({ id, key, response }: TrackedParcel) => {
    // The owner key is given once: it is on the device before anything else happens.
    rememberParcel({ id, key, view: response });
    reveal(id, response);
  }, [reveal]);
  const onSample = useCallback((sample: ParcelLinkView) => reveal(SAMPLE_LINK_ID, sample), [reveal]);

  const signIn = session.signIn;
  const onSignIn = useCallback(() => signIn(), [signIn]);
  const answer = revealed?.id === linkId ? revealed.view : undefined;

  return <PeekSessionProvider value={session}>
    {/* An address that became a parcel's before its page's code arrived keeps the door until it does. */}
    {linkId && screens
      ? <screens.ParcelPage key={linkId} linkId={linkId} entrance={answer ? 'reveal' : 'direct'} initial={answer} />
      : <FrontDoor onTracked={onTracked} onSample={onSample} onSignIn={onSignIn} />}
    {/* A word that outlives the page it was said on, such as a parcel forgotten. */}
    <NoticeToast />
  </PeekSessionProvider>;
}
