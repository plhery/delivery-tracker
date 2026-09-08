import { trackAction } from '../lib/analytics';
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import { abortable } from '../lib/apiClient';
import { browserStorage, clearApiCache } from '../store/apiRepo';
import { SessionStorage } from './sessionStorage';

export interface AuthConfig {
  url: string;
  publishableKey: string;
  googleEnabled: boolean;
  emailOtpEnabled: boolean;
}

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'unconfigured';

interface AuthState {
  signal: AbortSignal;
  status: AuthStatus;
  user: User | null;
  accessToken: string | null;
  googleEnabled: boolean;
  emailOtpEnabled: boolean;
  signInWithGoogle: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  getAccessToken: (refresh?: boolean) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function configuredClient(config: AuthConfig | null, storage: SessionStorage | null): SupabaseClient | null {
  if (!config?.url || !config.publishableKey) return null;
  return createClient(config.url, config.publishableKey, {
    global: {
      fetch: (input, init) => {
        const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]);
        return abortable(fetch(input, { ...init, signal }), signal);
      },
    },
    auth: {
      ...(storage ? { storage, storageKey: storage.key } : {}),
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      flowType: 'pkce',
    },
  });
}

function sessionState(client: SupabaseClient | null, session: Session | null) {
  if (!client) {
    return {
      status: 'unconfigured' as const,
      user: null,
      accessToken: null,
    };
  }
  return session && !session.user.is_anonymous
    ? {
        status: 'authenticated' as const,
        user: session.user,
        accessToken: session.access_token,
      }
    : {
        status: 'anonymous' as const,
        user: null,
        accessToken: null,
      };
}

export function AuthProvider({
  config,
  client: suppliedClient,
  children,
}: {
  config: AuthConfig | null;
  client?: SupabaseClient;
  children: ReactNode;
}) {
  const storage = useMemo(() => config?.url && !suppliedClient
    ? new SessionStorage(`sb-${new URL(config.url).hostname.split('.')[0]}-auth-token`) : null,
  [config, suppliedClient]);
  const client = useMemo(
    () => suppliedClient ?? configuredClient(config, storage),
    [config, suppliedClient, storage],
  );
  const [initialController] = useState(() => new AbortController());
  const identity = useRef({ userId: null as string | null, controller: initialController });
  const logout = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<Pick<AuthState, 'status' | 'user' | 'accessToken' | 'signal'>>(
    () => ({ ...(client ? { status: 'loading' as const, user: null, accessToken: null }
      : sessionState(null, null)), signal: initialController.signal }),
  );
  const acceptSession = useCallback((session: Session | null) => {
    if (storage?.blocked) session = null;
    const next = sessionState(client, session);
    const userId = next.user?.id ?? null;
    if (identity.current.userId !== userId || identity.current.controller.signal.aborted) {
      identity.current.controller.abort();
      if (identity.current.userId) clearApiCache(browserStorage(), identity.current.userId);
      identity.current = { userId, controller: new AbortController() };
    }
    setState({ ...next, signal: identity.current.controller.signal });
  }, [client, storage]);

  useEffect(() => {
    if (!client) return;

    let active = true;
    let observedSession = false;
    void client.auth.getSession().then(({ data, error }) => {
      if (!active || observedSession || logout.current) return;
      acceptSession(error ? null : data.session);
    });
    let signedIn = false;
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && !signedIn) trackAction('sign-in-complete', 'success');
      signedIn = Boolean(session);
      observedSession = true;
      if (active && !logout.current) acceptSession(session);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client, acceptSession]);

  const sendCode = useCallback(async (email: string) => {
    trackAction('sign-in-code-send', 'started');
    if (!client) throw new Error('Authentication is not configured');
    await logout.current;
    storage?.allowSignIn();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) { trackAction('sign-in-code-send', 'error'); throw error; }
    trackAction('sign-in-code-send', 'success');
  }, [client, storage]);

  const signInWithGoogle = useCallback(async () => {
    trackAction('sign-in-google', 'started');
    if (!client) throw new Error('Authentication is not configured');
    await logout.current;
    storage?.allowSignIn();
    const redirectTo = typeof window === 'undefined' ? undefined : window.location.origin;
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      ...(redirectTo ? { options: { redirectTo } } : {}),
    });
    if (error) { trackAction('sign-in-google', 'error'); throw error; }
    trackAction('sign-in-google', 'success');
  }, [client, storage]);

  const verifyCode = useCallback(async (email: string, code: string) => {
    trackAction('sign-in-code-verify', 'started');
    if (!client) throw new Error('Authentication is not configured');
    await logout.current;
    storage?.allowSignIn();
    const { data, error } = await client.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error) { trackAction('sign-in-code-verify', 'error'); throw error; }
    trackAction('sign-in-code-verify', 'success');
    if (!data.session) throw new Error('The sign-in code did not create a session');
    acceptSession(data.session);
  }, [client, acceptSession, storage]);

  const signOut = useCallback(async () => {
    if (!client) return;
    if (logout.current) return logout.current;
    const token = state.accessToken;
    trackAction('sign-out');
    storage?.signOut();
    acceptSession(null);
    const operation = (async () => {
      // Purging first prevents the SDK from refreshing expired credentials during logout.
      // Revoke the captured session separately; local logout also works without a network.
      await client.auth.signOut({ scope: 'local' });
      if (storage && token) await client.auth.admin.signOut(token, 'local');
    })().catch(() => undefined);
    logout.current = operation;
    try { await operation; } finally { logout.current = null; }
  }, [client, acceptSession, storage, state.accessToken]);

  const getAccessToken = useCallback(async (refresh = false) => {
    state.signal.throwIfAborted();
    if (!client || !state.user) return null;
    const { data, error } = refresh
      ? await client.auth.refreshSession()
      : await client.auth.getSession();
    state.signal.throwIfAborted();
    if (error) throw error;
    if (data.session && data.session.user.id !== state.user.id) {
      throw new DOMException('The signed-in account changed', 'AbortError');
    }
    return data.session?.access_token ?? null;
  }, [client, state.user, state.signal]);

  // These callbacks read lifecycle refs only when invoked by consumers.
  // The compiler currently treats passing them through useMemo as invoking them.
  /* eslint-disable react-hooks/refs */
  const value = useMemo(
    () => ({
      ...state,
      googleEnabled: config?.googleEnabled ?? false,
      emailOtpEnabled: config?.emailOtpEnabled ?? true,
      signInWithGoogle,
      sendCode,
      verifyCode,
      getAccessToken,
      signOut,
    }),
    [
      state,
      config?.googleEnabled,
      config?.emailOtpEnabled,
      signInWithGoogle,
      sendCode,
      verifyCode,
      getAccessToken,
      signOut,
    ],
  );

  /* eslint-enable react-hooks/refs */
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
