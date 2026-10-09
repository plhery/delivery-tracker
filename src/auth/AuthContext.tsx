import { trackAction } from '../lib/analytics';
import type { AuthChangeEvent, GoTrueClient, Session, User } from '@supabase/auth-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import { useI18n } from '../i18n';
import { abortable } from '../lib/apiClient';
import { whenIdle } from '../lib/idle';
import { rememberRequestedParcel } from '../lib/requestedParcel';
import { browserStorage, clearApiCache } from '../store/apiRepo';
import { holdsSignIn } from './savedSignIn';
import { SessionStorage } from './sessionStorage';

export interface AuthConfig {
  url: string;
  publishableKey: string;
  googleEnabled: boolean;
  appleEnabled: boolean;
  emailOtpEnabled: boolean;
}

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'unconfigured';

interface AuthState {
  signal: AbortSignal;
  status: AuthStatus;
  user: User | null;
  accessToken: string | null;
  googleEnabled: boolean;
  appleEnabled: boolean;
  emailOtpEnabled: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  getAccessToken: (refresh?: boolean) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** The web app only signs in; the auth client alone avoids shipping the unused database, storage and realtime clients. */
type SupabaseAuth = { auth: GoTrueClient };

let sdk: Promise<typeof import('@supabase/auth-js')> | undefined;

/** The auth SDK, which a visitor's page comes alive without. A failed fetch is forgotten, so the next ask tries again. */
function authSdk() {
  return sdk ??= import('@supabase/auth-js').catch((error: unknown) => {
    sdk = undefined;
    throw error;
  });
}

async function configuredClient(config: AuthConfig, storage: SessionStorage | null): Promise<SupabaseAuth> {
  const { AuthClient } = await authSdk();
  return {
    auth: new AuthClient({
      url: new URL('/auth/v1', config.url).href,
      headers: { Authorization: `Bearer ${config.publishableKey}`, apikey: config.publishableKey },
      fetch: (input, init) => {
        const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]);
        return abortable(fetch(input, { ...init, signal }), signal);
      },
      ...(storage ? { storage, storageKey: storage.key } : {}),
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      flowType: 'pkce',
    }),
  };
}

/** A page opened by a sign-in link or a Google/Apple return, which the SDK exchanges for a session. */
function signInRedirect(): boolean {
  return typeof window !== 'undefined' && (/[?&](code|error)=/.test(window.location.search)
    || /(access_token|error)=/.test(window.location.hash));
}

// A browser that holds a sign-in, or returns from one, needs the SDK to refresh or exchange it: it asks with the page's own code.
if (typeof window !== 'undefined' && (signInRedirect() || holdsSignIn())) void authSdk().catch(() => undefined);

/** The saved sign-in, read without the network; the SDK verifies and refreshes it separately. */
function savedSession(storage: SessionStorage | null): Session | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(storage.key) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const session = value as Partial<Session>;
    return typeof session.access_token === 'string' && typeof session.refresh_token === 'string'
      && typeof session.user?.id === 'string' ? session as Session : null;
  } catch {
    return null;
  }
}

function sessionState(configured: boolean, session: Session | null) {
  if (!configured) {
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
  client?: SupabaseAuth;
  children: ReactNode;
}) {
  const storage = useMemo(() => config?.url && !suppliedClient
    ? new SessionStorage(`sb-${new URL(config.url).hostname.split('.')[0]}-auth-token`) : null,
  [config, suppliedClient]);
  const configured = Boolean(suppliedClient || (config?.url && config.publishableKey));
  // The client, once its SDK is here. Whatever needs it sooner asks for it, and waits.
  const [client, setClient] = useState<SupabaseAuth | null>(suppliedClient ?? null);
  const clientRequest = useRef<Promise<SupabaseAuth> | null>(null);
  const requestClient = useCallback((): Promise<SupabaseAuth> => {
    if (suppliedClient) return Promise.resolve(suppliedClient);
    if (!config?.url || !config.publishableKey) return Promise.reject(new Error('Authentication is not configured'));
    return clientRequest.current ??= configuredClient(config, storage).then((created) => {
      setClient(created);
      return created;
    }, (error: unknown) => {
      clientRequest.current = null;
      throw error;
    });
  }, [config, suppliedClient, storage]);
  const [initialController] = useState(() => new AbortController());
  const identity = useRef({ userId: null as string | null, controller: initialController });
  const logout = useRef<Promise<void> | null>(null);
  const { locale } = useI18n();
  const savedLocale = useRef<string | null>(null);
  // The SDK also says SIGNED_IN when it restores a saved session. A sign-in is
  // complete only after a code entered here or a sign-in redirect.
  const signingIn = useRef(signInRedirect());
  const [state, setState] = useState<Pick<AuthState, 'status' | 'user' | 'accessToken' | 'signal'>>(
    () => ({ ...(configured ? { status: 'loading' as const, user: null, accessToken: null }
      : sessionState(false, null)), signal: initialController.signal }),
  );
  const acceptSession = useCallback((session: Session | null) => {
    if (storage?.blocked) session = null;
    const next = sessionState(configured, session);
    const userId = next.user?.id ?? null;
    if (identity.current.userId !== userId || identity.current.controller.signal.aborted) {
      identity.current.controller.abort();
      if (identity.current.userId) clearApiCache(browserStorage(), identity.current.userId);
      identity.current = { userId, controller: new AbortController() };
    }
    setState({ ...next, signal: identity.current.controller.signal });
  }, [configured, storage]);

  // Returning users open straight into their account. Waiting for the SDK would
  // hold the first screen on a token refresh, or on its retries while offline.
  // A browser that holds no sign-in is a visitor's from the start.
  // Sign-in redirects exchange a new session and must not show the previous one.
  useLayoutEffect(() => {
    if (!storage || signInRedirect()) return;
    acceptSession(savedSession(storage));
  }, [storage, acceptSession]);

  // A saved sign-in or a sign-in redirect needs the client at once. A visitor's page fetches it once idle, so that a
  // sign-in started here, or in another tab, finds it ready. Without it the page stays with what it saved.
  useEffect(() => {
    if (client || !configured) return;
    const fetchClient = () => {
      requestClient().catch(() => { if (!logout.current) acceptSession(savedSession(storage)); });
    };
    if (signInRedirect() || savedSession(storage)) {
      fetchClient();
      return;
    }
    return whenIdle(fetchClient);
  }, [client, configured, requestClient, acceptSession, storage]);

  useEffect(() => {
    if (!client) return;

    let active = true;
    let observedSession = false;
    // A refresh that fails offline keeps the saved sign-in. Only an explicit
    // sign-out, or the SDK discarding a rejected session, ends the account view.
    const accept = (session: Session | null, event?: AuthChangeEvent) => {
      acceptSession(session ?? (event === 'SIGNED_OUT' ? null : savedSession(storage)));
    };
    void client.auth.getSession().then(({ data, error }) => {
      if (!active || observedSession || logout.current) return;
      accept(error ? null : data.session);
    });
    let signedIn = false;
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && !signedIn && signingIn.current) {
        signingIn.current = false;
        trackAction('sign-in-complete', 'success');
      }
      signedIn = Boolean(session);
      observedSession = true;
      if (active && !logout.current) accept(session, event);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client, storage, acceptSession]);

  const sendCode = useCallback(async (email: string) => {
    trackAction('sign-in-code-send', 'started');
    const { auth } = client ?? await requestClient();
    await logout.current;
    storage?.allowSignIn();
    const { error } = await auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, data: { locale } },
    });
    if (error) { trackAction('sign-in-code-send', 'error'); throw error; }
    trackAction('sign-in-code-send', 'success');
  }, [client, requestClient, storage, locale]);

  // The sign-in email template reads the account language from user metadata.
  useEffect(() => {
    const user = state.user;
    if (!client || !user || user.user_metadata?.locale === locale) return;
    const attempt = `${user.id}:${locale}`;
    if (savedLocale.current === attempt) return;
    // Waiting lets the saved language replace the initial English render first.
    const timer = window.setTimeout(() => {
      savedLocale.current = attempt;
      void client.auth.updateUser({ data: { locale } }).catch(() => undefined);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [client, locale, state.user]);

  const signInWithProvider = useCallback(async (provider: 'google' | 'apple') => {
    const event = provider === 'apple' ? 'sign-in-apple' : 'sign-in-google';
    trackAction(event, 'started');
    const { auth } = client ?? await requestClient();
    await logout.current;
    storage?.allowSignIn();
    // The provider returns to the origin alone: a parcel the address asks for is noted for the way back.
    rememberRequestedParcel();
    const redirectTo = typeof window === 'undefined' ? undefined : window.location.origin;
    const { error } = await auth.signInWithOAuth({
      provider,
      ...(redirectTo ? { options: { redirectTo } } : {}),
    });
    if (error) { trackAction(event, 'error'); throw error; }
    trackAction(event, 'success');
  }, [client, requestClient, storage]);

  const signInWithGoogle = useCallback(() => signInWithProvider('google'), [signInWithProvider]);
  const signInWithApple = useCallback(() => signInWithProvider('apple'), [signInWithProvider]);

  const verifyCode = useCallback(async (email: string, code: string) => {
    trackAction('sign-in-code-verify', 'started');
    const { auth } = client ?? await requestClient();
    await logout.current;
    storage?.allowSignIn();
    signingIn.current = true;
    const { data, error } = await auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error) { signingIn.current = false; trackAction('sign-in-code-verify', 'error'); throw error; }
    trackAction('sign-in-code-verify', 'success');
    if (!data.session) throw new Error('The sign-in code did not create a session');
    acceptSession(data.session);
  }, [client, requestClient, acceptSession, storage]);

  const signOut = useCallback(async () => {
    if (!configured) return;
    if (logout.current) return logout.current;
    const token = state.accessToken;
    trackAction('sign-out');
    storage?.signOut();
    acceptSession(null);
    const operation = (async () => {
      // Purging first prevents the SDK from refreshing expired credentials during logout.
      // Revoke the captured session separately; local logout also works without a network.
      const { auth } = client ?? await requestClient();
      await auth.signOut({ scope: 'local' });
      if (storage && token) await auth.admin.signOut(token, 'local');
    })().catch(() => undefined);
    logout.current = operation;
    try { await operation; } finally { logout.current = null; }
  }, [configured, client, requestClient, acceptSession, storage, state.accessToken]);

  // Token refreshes replace the user object; consumers stay bound to the account.
  const userId = state.user?.id ?? null;
  const getAccessToken = useCallback(async (refresh = false) => {
    state.signal.throwIfAborted();
    if (!configured || !userId) return null;
    const { auth } = client ?? await requestClient();
    const { data, error } = refresh
      ? await auth.refreshSession()
      : await auth.getSession();
    state.signal.throwIfAborted();
    if (error) throw error;
    if (data.session && data.session.user.id !== userId) {
      throw new DOMException('The signed-in account changed', 'AbortError');
    }
    return data.session?.access_token ?? null;
  }, [configured, client, requestClient, userId, state.signal]);

  const value = useMemo(
    () => ({
      ...state,
      googleEnabled: config?.googleEnabled ?? false,
      appleEnabled: config?.appleEnabled ?? false,
      emailOtpEnabled: config?.emailOtpEnabled ?? true,
      signInWithGoogle,
      signInWithApple,
      sendCode,
      verifyCode,
      getAccessToken,
      signOut,
    }),
    [
      state,
      config?.googleEnabled,
      config?.appleEnabled,
      config?.emailOtpEnabled,
      signInWithGoogle,
      signInWithApple,
      sendCode,
      verifyCode,
      getAccessToken,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
