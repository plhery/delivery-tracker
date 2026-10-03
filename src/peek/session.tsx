import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import type { SignInScreen } from '../components/SignInScreen';
import type { ParcelWithEvents } from '../types';
import type { KeepOutcome } from './pending';

/** The ways to sign in that a build with accounts offers. */
export type SignInMethods = Pick<ComponentProps<typeof SignInScreen>,
  'configured' | 'googleEnabled' | 'appleEnabled' | 'emailOtpEnabled' | 'signInWithGoogle' | 'signInWithApple' | 'sendCode' | 'verifyCode'>;

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
  /** Lets a visitor sign in without leaving the page they are on. Absent where signing in is its own step, as in the demo. */
  signInWith?: SignInMethods;
  /** The server emails an account that asks for it when a parcel is delivered. Absent where it sends none. */
  deliveryEmails?: boolean;
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
