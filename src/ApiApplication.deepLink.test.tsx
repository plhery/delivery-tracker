import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GoTrueClient, Session } from '@supabase/auth-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import contractFixture from '../contracts/fixtures/delivery-api.json';
import { ApiApplication } from './ApiApplication';
import { AuthProvider } from './auth/AuthContext';
import { REQUESTED_PARCEL_STORAGE_KEY as NOTE_KEY } from './lib/requestedParcel';
import { stubIntersections } from './test/intersections';

// A link to one of an account's parcels, as a delivery email and a notification carry it,
// opened in a browser that is not signed in: the whole app, with only the network and the
// sign-in service stood in for.
const packageRow = contractFixture.packageList.packages[0];
const PARCEL_LINK = `/?parcel=${packageRow.id}`;
const SESSION = {
  access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, token_type: 'bearer',
  user: { id: '10000000-0000-0000-0000-000000000001', email: 'alex@example.com' },
} as Session;
const CONFIG = { url: 'https://auth.example.test', publishableKey: 'publishable', googleEnabled: true, appleEnabled: false, emailOtpEnabled: true };

function authClient(session: Session | null = null) {
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }),
    refreshSession: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
  };
  return { client: { auth } as unknown as { auth: GoTrueClient }, auth };
}

const app = (client: { auth: GoTrueClient }) => render(<AuthProvider config={CONFIG} client={client}><ApiApplication /></AuthProvider>);
const door = () => screen.findByRole('heading', { level: 1, name: 'Where’s my parcel?' });
const parcel = () => screen.findByRole('dialog', { name: 'Coffee beans' });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  stubIntersections();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  // The account's deliveries; everything else the signed-in app asks for is not there.
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (path) => String(path).startsWith('/api/packages?')
    ? new Response(JSON.stringify({ packages: [packageRow] }))
    : new Response('{}', { status: 404 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('a link to one of the account’s parcels, opened signed out', () => {
  it('keeps the parcel in the address through the front door and a sign-in by emailed code, then opens it', async () => {
    window.history.replaceState(null, '', PARCEL_LINK);
    const { client, auth } = authClient();
    const user = userEvent.setup();
    app(client);
    await door();
    expect(window.location.search).toBe(`?parcel=${packageRow.id}`);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Sign in with email' }));
    expect(window.location.search).toBe(`?parcel=${packageRow.id}`);
    await user.type(screen.getByLabelText('Email address'), 'alex@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await user.type(await screen.findByLabelText('Sign-in code'), '123456');
    await user.click(screen.getByRole('button', { name: 'View my parcels' }));
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'alex@example.com', token: '123456', type: 'email' });

    // The session exists: the parcel the link named opens.
    expect(await parcel()).toBeVisible();
    expect(window.location.search).toBe(`?parcel=${packageRow.id}`);
    // The page never left, so nothing had to be noted.
    expect(sessionStorage.getItem(NOTE_KEY)).toBeNull();
  });

  it('notes the parcel before leaving for Google, which returns to `/` alone, and opens it on the way back', async () => {
    window.history.replaceState(null, '', PARCEL_LINK);
    const visitor = authClient();
    const user = userEvent.setup();
    const before = app(visitor.client);
    await door();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(visitor.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: window.location.origin } }));
    expect(JSON.parse(sessionStorage.getItem(NOTE_KEY)!)).toMatchObject({ id: packageRow.id });

    // The browser leaves for the provider and comes back to the origin, signed in.
    before.unmount();
    window.history.replaceState(null, '', '/');
    app(authClient(SESSION).client);
    expect(await parcel()).toBeVisible();
    expect(window.location.search).toBe(`?parcel=${packageRow.id}`);
    expect(sessionStorage.getItem(NOTE_KEY)).toBeNull();
  });

  it('opens the deliveries alone after a sign-in that started at `/`', async () => {
    const visitor = authClient();
    const user = userEvent.setup();
    const before = app(visitor.client);
    await door();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(visitor.auth.signInWithOAuth).toHaveBeenCalled());
    expect(sessionStorage.getItem(NOTE_KEY)).toBeNull();

    before.unmount();
    app(authClient(SESSION).client);
    expect(await screen.findByText('Coffee beans')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.search).toBe('');
  });
});
