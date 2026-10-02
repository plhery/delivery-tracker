import { createContext, useContext, type ReactNode } from 'react';
import type { ParcelWithEvents } from '../types';
import type { KeepOutcome } from './pending';

/**
 * Who is looking at the front door or a parcel page, and what they can do
 * about an account. The app's entry points fill it in; the peek screens read
 * it instead of the sign-in machinery, which only exists in builds with an API.
 */
export interface PeekSession {
  /** `checking` while a saved sign-in is being restored; the demo build only has visitors. */
  account: 'checking' | 'visitor' | 'signed-in';
  /** Opens the sign-in step. With a link id, that parcel is kept as soon as the visitor is signed in. */
  signIn(keepLinkId?: string): void;
  /** Keeps a parcel link in the account. Only someone signed in can. */
  keep?(linkId: string): Promise<KeepOutcome>;
  /** The deliveries of the account, once loaded: tells a parcel already followed from a new one. */
  deliveries?: readonly ParcelWithEvents[];
  /** Leaves for the deliveries app, opening one of its parcels when given its id. */
  openDeliveries?(parcelId?: string): void;
}

const visitor: PeekSession = { account: 'visitor', signIn: () => undefined };
const PeekSessionContext = createContext<PeekSession>(visitor);

export function PeekSessionProvider({ value, children }: { value: PeekSession; children: ReactNode }) {
  return <PeekSessionContext.Provider value={value}>{children}</PeekSessionContext.Provider>;
}

/** Outside a provider the reader is a visitor who cannot sign in from here. */
export function usePeekSession(): PeekSession {
  return useContext(PeekSessionContext);
}
