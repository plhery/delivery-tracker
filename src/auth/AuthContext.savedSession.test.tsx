import { act, render, screen } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/auth-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const client = vi.hoisted(() => ({
  options: [] as unknown[],
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
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

function Status() {
  const auth = useAuth();
  return <span>{`${auth.status}:${auth.user?.id ?? ''}`}</span>;
}

beforeEach(() => {
  client.auth.updateUser.mockResolvedValue({ data: { user: null }, error: null });
  client.auth.onAuthStateChange.mockImplementation((callback: typeof emit) => {
    emit = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  client.options.length = 0;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

it('creates a PKCE auth client for the project with the publishable key', () => {
  client.auth.getSession.mockReturnValue(new Promise(() => undefined));
  render(<AuthProvider config={CONFIG}><Status /></AuthProvider>);

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
  await act(async () => { emit('INITIAL_SESSION', null); });

  expect(screen.getByText('authenticated:user-1')).toBeInTheDocument();
});

it('ends the account when Supabase discards the saved sign-in', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
  client.auth.getSession.mockReturnValue(new Promise(() => undefined));

  render(<AuthProvider config={CONFIG}><Status /></AuthProvider>);
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

it('starts signed out when nothing is saved', async () => {
  client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

  render(<AuthProvider config={CONFIG}><Status /></AuthProvider>);
  expect(screen.getByText('loading:')).toBeInTheDocument();
  expect(await screen.findByText('anonymous:')).toBeInTheDocument();
});
