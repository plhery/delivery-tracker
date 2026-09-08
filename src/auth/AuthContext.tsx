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

function configuredClient(config: AuthConfig | null): SupabaseClient | null {
  if (!config?.url || !config.publishableKey) return null;
  return createClient(config.url, config.publishableKey, {
    global: {
      fetch: (input, init) => {
        const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]);
        return abortable(fetch(input, { ...init, signal }), signal);
      },
    },
    auth: {
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
  const client = useMemo(
    () => suppliedClient ?? configuredClient(config),
    [config, suppliedClient],
  );
  const [initialController] = useState(() => new AbortController());
  const identity = useRef({ userId: null as string | null, controller: initialController });
  const logout = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<Pick<AuthState, 'status' | 'user' | 'accessToken' | 'signal'>>(
    () => ({ ...(client ? { status: 'loading' as const, user: null, accessToken: null }
      : sessionState(null, null)), signal: initialController.signal }),
  );
  const acceptSession = useCallback((session: Session | null) => {
    const next = sessionState(client, session);
    const userId = next.user?.id ?? null;
    if (identity.current.userId !== userId || identity.current.controller.signal.aborted) {
      identity.current.controller.abort();
      if (identity.current.userId) clearApiCache(browserStorage(), identity.current.userId);
      identity.current = { userId, controller: new AbortController() };
    }
    setState({ ...next, signal: identity.current.controller.signal });
  }, [client]);

  useEffect(() => {
    if (!client) return;

    let active = true;
    let observedSession = false;
    void client.auth.getSession().then(({ data, error }) => {
      if (!active || observedSession || logout.current) return;
      acceptSession(error ? null : data.session);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      observedSession = true;
      if (active && !logout.current) acceptSession(session);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client, acceptSession]);

  const sendCode = useCallback(async (email: string) => {
    if (!client) throw new Error('Authentication is not configured');
    await logout.current;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
  }, [client]);

  const signInWithGoogle = useCallback(async () => {
    if (!client) throw new Error('Authentication is not configured');
    await logout.current;
    const redirectTo = typeof window === 'undefined' ? undefined : window.location.origin;
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      ...(redirectTo ? { options: { redirectTo } } : {}),
    });
    if (error) throw error;
  }, [client]);

  const verifyCode = useCallback(async (email: string, code: string) => {
    if (!client) throw new Error('Authentication is not configured');
    await logout.current;
    const { data, error } = await client.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error) throw error;
    if (!data.session) throw new Error('The sign-in code did not create a session');
    acceptSession(data.session);
  }, [client, acceptSession]);

  const signOut = useCallback(async () => {
    if (!client) return;
    if (logout.current) return logout.current;
    acceptSession(null);
    const operation = client.auth.signOut({ scope: 'local' }).then(() => undefined);
    logout.current = operation;
    try { await operation; } finally { logout.current = null; }
  }, [client, acceptSession]);

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
