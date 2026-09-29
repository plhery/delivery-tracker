import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthChangeEvent, GoTrueClient, Session } from '@supabase/auth-js';
import { afterEach, expect, it, vi } from 'vitest';
import { trackAction } from '../lib/analytics';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../lib/analytics', () => ({ trackAction: vi.fn() }));

const SESSION = {
  access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, token_type: 'bearer',
  user: { id: 'user-1', email: 'owner@example.test' },
} as Session;

function authClient() {
  let emit: (event: AuthChangeEvent, session: Session | null) => void = () => undefined;
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn((listener: typeof emit) => {
      emit = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    // Like the SDK, announce the new session before the call returns.
    verifyOtp: vi.fn(async () => {
      emit('SIGNED_IN', SESSION);
      return { data: { session: SESSION }, error: null };
    }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
  };
  return { client: { auth } as unknown as { auth: GoTrueClient }, emit: (event: AuthChangeEvent, session: Session | null) => emit(event, session) };
}

function Verify() {
  const auth = useAuth();
  return <button type="button" onClick={() => void auth.verifyCode('owner@example.test', '123456')}>Verify</button>;
}

const completions = () => vi.mocked(trackAction).mock.calls.filter(([action]) => action === 'sign-in-complete');

afterEach(() => {
  vi.mocked(trackAction).mockClear();
  window.history.replaceState(null, '', '/');
});

it('does not count a restored session as a sign-in', async () => {
  const { client, emit } = authClient();
  render(<AuthProvider config={null} client={client}><Verify /></AuthProvider>);
  // The SDK announces a session it restores from storage as SIGNED_IN, before
  // INITIAL_SESSION, and again whenever the tab becomes visible.
  act(() => emit('SIGNED_IN', SESSION));
  act(() => emit('INITIAL_SESSION', SESSION));
  act(() => emit('SIGNED_IN', SESSION));
  expect(completions()).toEqual([]);
});

it('counts a sign-in completed with an emailed code once', async () => {
  const { client } = authClient();
  render(<AuthProvider config={null} client={client}><Verify /></AuthProvider>);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Verify' }));
  await waitFor(() => expect(completions()).toEqual([['sign-in-complete', 'success']]));
});

it('counts a sign-in completed by a sign-in link or a Google or Apple return', () => {
  window.history.replaceState(null, '', '/?code=synthetic-code');
  const { client, emit } = authClient();
  render(<AuthProvider config={null} client={client}><Verify /></AuthProvider>);
  act(() => emit('SIGNED_IN', SESSION));
  act(() => emit('SIGNED_OUT', null));
  act(() => emit('SIGNED_IN', SESSION));
  expect(completions()).toEqual([['sign-in-complete', 'success']]);
});
