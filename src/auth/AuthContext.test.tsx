import { useState } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const SESSION = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: 'user-1',
    email: 'owner@example.test',
  },
} as Session;

function authClient(session: Session | null = null) {
  const unsubscribe = vi.fn();
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe } },
    }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }),
    refreshSession: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  return { client: { auth } as unknown as SupabaseClient, auth, unsubscribe };
}

function AuthHarness() {
  const auth = useAuth();
  const [latestToken, setLatestToken] = useState('');
  return (
    <div>
      <span>{auth.status}</span>
      <span>{auth.user?.email}</span>
      <span>{auth.accessToken}</span>
      <button type="button" onClick={() => void auth.sendCode('owner@example.test')}>Send</button>
      <button type="button" onClick={() => void auth.signInWithGoogle()}>Google</button>
      <button type="button" onClick={() => void auth.verifyCode('owner@example.test', '123456')}>
        Verify
      </button>
      <button type="button" onClick={() => void auth.signOut()}>Sign out</button>
      <button
        type="button"
        onClick={() => void auth.getAccessToken(true).then((token) => setLatestToken(token ?? ''))}
      >
        Refresh token
      </button>
      <span>{latestToken}</span>
    </div>
  );
}

describe('AuthProvider', () => {
  it('restores and locally signs out a persisted session', async () => {
    const { client, auth, unsubscribe } = authClient(SESSION);
    const user = userEvent.setup();
    const result = render(
      <AuthProvider config={null} client={client}>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText('authenticated')).toBeInTheDocument();
    expect(screen.getByText('owner@example.test')).toBeInTheDocument();
    expect(screen.getByText('access-token')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh token' }));
    await waitFor(() => expect(auth.refreshSession).toHaveBeenCalledOnce());

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(screen.getByText('anonymous')).toBeInTheDocument();

    result.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not treat a legacy anonymous session as an account', async () => {
    const anonymousSession = {
      ...SESSION,
      user: {
        ...SESSION.user,
        email: undefined,
        is_anonymous: true,
      },
    } as Session;
    const { client } = authClient(anonymousSession);

    render(
      <AuthProvider config={null} client={client}>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(screen.queryByText('access-token')).not.toBeInTheDocument();
  });

  it('sends and verifies email codes through Supabase Auth', async () => {
    const { client, auth } = authClient();
    const user = userEvent.setup();
    render(
      <AuthProvider config={null} client={client}>
        <AuthHarness />
      </AuthProvider>,
    );
    await screen.findByText('anonymous');

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'owner@example.test',
      options: { shouldCreateUser: true },
    });

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'owner@example.test',
      token: '123456',
      type: 'email',
    });
    expect(await screen.findByText('authenticated')).toBeInTheDocument();
  });

  it('starts Google OAuth with a same-origin callback', async () => {
    const { client, auth } = authClient();
    const user = userEvent.setup();
    render(
      <AuthProvider
        config={{
          url: 'https://project.supabase.co',
          publishableKey: 'publishable-key',
          googleEnabled: true,
          emailOtpEnabled: false,
        }}
        client={client}
      >
        <AuthHarness />
      </AuthProvider>,
    );
    await screen.findByText('anonymous');
    await user.click(screen.getByRole('button', { name: 'Google' }));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  });

  it('reports missing public authentication configuration', () => {
    render(
      <AuthProvider config={null}>
        <AuthHarness />
      </AuthProvider>,
    );
    expect(screen.getByText('unconfigured')).toBeInTheDocument();
  });
});


it('invalidates old token getters when another account signs in during refresh', async () => {
  const { client, auth } = authClient(SESSION);
  const { result } = renderHook(() => useAuth(), {
    wrapper: ({ children }) => <AuthProvider config={null} client={client}>{children}</AuthProvider>,
  });
  await waitFor(() => expect(result.current.user?.id).toBe('user-1'));
  const previous = result.current;
  let finish!: (value: unknown) => void;
  auth.refreshSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = previous.getAccessToken(true);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const next = { ...SESSION, user: { ...SESSION.user, id: 'user-2' }, access_token: 'private-B' };
  const listener = auth.onAuthStateChange.mock.calls[0][0] as unknown as (event: string, session: Session) => void;
  act(() => listener('SIGNED_IN', next));
  expect(previous.signal.aborted).toBe(true);
  finish({ data: { session: next }, error: null });
  await rejected;
  expect(result.current.user?.id).toBe('user-2');
});

it('clears the account immediately while remote sign-out is pending', async () => {
  const { client, auth } = authClient(SESSION);
  let finish!: (value: { error: null }) => void;
  auth.signOut.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useAuth(), {
    wrapper: ({ children }) => <AuthProvider config={null} client={client}>{children}</AuthProvider>,
  });
  await waitFor(() => expect(result.current.user).not.toBeNull());
  const previousSignal = result.current.signal;
  let pending!: Promise<void>;
  act(() => { pending = result.current.signOut(); });
  expect(result.current.status).toBe('anonymous');
  expect(previousSignal.aborted).toBe(true);
  finish({ error: null });
  await pending;
});
