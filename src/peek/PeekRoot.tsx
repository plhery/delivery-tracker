import { useCallback, useState } from 'react';
import { flushSync } from 'react-dom';
import { FrontDoor, type TrackedParcel } from './FrontDoor';
import type { ParcelLinkView } from './links';
import { ParcelPage } from './ParcelPage';
import { rememberParcel } from './recents';
import { openParcelLink, useParcelLinkRoute } from './route';
import { PeekSessionProvider, type PeekSession } from './session';

type ViewTransitions = { startViewTransition?: (update: () => void) => unknown };

/**
 * What someone without an open deliveries app sees: the parcel page at
 * `/p/<id>`, the front door anywhere else. It owns the hand-over between the
 * two: when a lookup answers, the address becomes the parcel's own and the
 * page opens with that answer.
 */
export function PeekRoot({ session, serverLinkId = null }: {
  session: PeekSession;
  /** The link id the server rendered the page for. */
  serverLinkId?: string | null;
}) {
  const linkId = useParcelLinkRoute(serverLinkId);
  const [revealed, setRevealed] = useState<{ id: string; view: ParcelLinkView } | null>(null);
  // The reveal belongs to one arrival: coming back to the page later opens it like any link.
  if (revealed && revealed.id !== linkId) setRevealed(null);

  const onTracked = useCallback(({ id, key, response }: TrackedParcel) => {
    // The owner key is given once: it is on the device before anything else happens.
    rememberParcel({ id, key, view: response });
    const show = () => {
      setRevealed({ id, view: response });
      openParcelLink(id);
    };
    // The address and the answer change in one render, so the page mounts with its answer.
    const handOver = () => flushSync(show);
    const transitions = document as ViewTransitions;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still || typeof transitions.startViewTransition !== 'function') handOver();
    // Pip keeps one transition name across both views, so the browser moves it from the door into the page.
    else transitions.startViewTransition(handOver);
  }, []);

  const signIn = session.signIn;
  const onSignIn = useCallback(() => signIn(), [signIn]);
  const answer = revealed?.id === linkId ? revealed.view : undefined;

  return <PeekSessionProvider value={session}>
    {linkId
      ? <ParcelPage key={linkId} linkId={linkId} entrance={answer ? 'reveal' : 'direct'} initial={answer} />
      : <FrontDoor onTracked={onTracked} onSignIn={onSignIn} />}
  </PeekSessionProvider>;
}
