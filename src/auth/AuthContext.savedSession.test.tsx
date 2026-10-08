import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/auth-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const client = vi.hoisted(() => ({
  options: [] as unknown[],
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithOtp: vi.fn(),
    updateUser: vi.fn(),
  },
}));
vi.mock('@supabase/auth-js', () => ({
  AuthClient: class {
    constructor(options: unknown) {
      client.options.push(options);
      return client.auth;
    }
  },
}));

const CONFIG = {
  url: 'https://project.supabase.example',
  publishableKey: 'public-key',
  googleEnabled: false,
  appleEnabled: false,
  emailOtpEnabled: true,
};
const STORAGE_KEY = 'sb-project-auth-token';
const SAVED = {
  access_token: 'expired-access-token',
  refresh_token: 'refresh-token',
  expires_at: 1,
  token_type: 'bearer',
  user: { id: 'user-1', email: 'owner@example.test' },
} as unknown as Session;

let emit: (event: AuthChangeEvent, session: Session | null) => void;
let idle: (() => void) | undefined;

function Status() {
  const auth = useAuth();
  return <span>{`${auth.status}:${auth.user?.id ?? ''}`}</span>;
}

beforeEach(() => {
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => { idle = callback; return 1; });
  vi.stubGlobal('cancelIdleCallback', () => { idle = undefined; });
  client.auth.updateUser.mockResolvedValue({ data: { user: null }, error: null });
  client.auth.onAuthStateChange.mockImplementation((callback: typeof emit) => {
    emit = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  idle = undefined;
  vi.clearAllMocks();
  client.options.length = 0;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

it('creates a PKCE auth client for the project with the publishable key once the page is idle', async () => {
  client.auth.getSession.mockReturnValue(new Promise(() => undefined));
  render(<AuthProvider config={CONFIG}><Status /></AuthProvider>);
  expect(client.options).toHaveLength(0);

  act(() => idle?.());
  await waitFor(() => expect(client.options).toHaveLength(1));
  expect(client.options[0]).toMatchObject({
    url: 'https://project.supabase.example/auth/v1',
    headers: { Authorization: 'Bearer public-key', apikey: 'public-key' },
    storageKey: STORAGE_KEY,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
    flowType: 'pkce',
  });
});

it('opens a returning account from its saved sign-in while the token refreshes', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
  client.auth.getSession.mockReturnValue(new Promise(() => undefined));

  render(<AuthProvider config={CONFIG}><Status /></AuthProvider>);

  expect(screen.getByText('authenticated:user-1')).toBeInTheDocument();
});

it('keeps the saved account when its refresh fails offline', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
  client.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('Failed to fetch') });

  render(<AuthProvider config={CONFIG}><Status /></AuthProvider>);
  await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled());
  await act(async () => { emit('INITIAL_SESSION', null); });

  expect(screen.getByText('authenticated:user-1')).toBeInTheDocument();
});

it('ends the account when Supabase discards the saved sign-in', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
  client.auth.getSession.mockReturnValue(new Promise(() => undefined));

  render(<AuthProvider config={CONFIG}><Status /></AuthProvider>);
  await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled());
  await act(async () => {
    localStorage.removeItem(STORAGE_KEY);
    emit('SIGNED_OUT', null);
  });

  expect(screen.getByText('anonymous:')).toBeInTheDocument();
});

it('waits for a sign-in redirect instead of showing the previous account', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
  window.history.replaceState(null, '', '/?code=callback-code');
  let finish!: (value: unknown) => void;
  client.auth.getSession.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

  render(<AuthProvider config={CONFIG}><Status /></AuthProvider>);
  expect(screen.getByText('loading:')).toBeInTheDocument();

  const signedIn = { ...SAVED, user: { ...SAVED.user, id: 'user-2' } } as Session;
  await act(async () => { finish({ data: { session: signedIn }, error: null }); });
  expect(screen.getByText('authenticated:user-2')).toBeInTheDocument();
});

it('starts signed out at once when nothing is saved, without the auth client', async () => {
  client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

  render(<AuthProvider config={CONFIG}><Status /></AuthProvider>);
  expect(screen.getByText('anonymous:')).toBeInTheDocument();
  expect(client.options).toHaveLength(0);

  act(() => idle?.());
  await waitFor(() => expect(client.auth.getSession).toHaveBeenCalled());
  expect(screen.getByText('anonymous:')).toBeInTheDocument();
});

it('fetches the auth client for a sign-in started before it arrived', async () => {
  client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  client.auth.signInWithOtp.mockResolvedValue({ error: null });
  const { result } = renderHook(() => useAuth(), { wrapper: ({ children }) => <AuthProvider config={CONFIG}>{children}</AuthProvider> });

  await act(() => result.current.sendCode('owner@example.test'));

  expect(client.options).toHaveLength(1);
  expect(client.auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ email: 'owner@example.test' }));
});
