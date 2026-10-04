import 'server-only';

type HeaderReader = Pick<Headers, 'get'>;

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first && first.length <= 253 ? first : null;
}

/** The host a request was made to: `Host`, which the reverse proxy passes on, then the forwarded host. */
export function requestHost(headers: HeaderReader): string | null {
  return firstHeaderValue(headers.get('host')) ?? firstHeaderValue(headers.get('x-forwarded-host'));
}

/** That host as a name to compare: lower case, without a port or a trailing dot. */
export function requestHostname(headers: HeaderReader): string | null {
  return requestHost(headers)?.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '') || null;
}

export interface SiteHosts {
  /** Where every page lives, such as `https://peek.example.com`. */
  canonicalOrigin: string;
  /** Hostnames the site answered on before; their pages now live on the canonical origin. */
  legacyHosts: readonly string[];
}

const hostnamePattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Reads `CANONICAL_ORIGIN` and `LEGACY_HOSTS`. Unset, the site has one host
 * and nothing moves. A malformed value throws, so a deployment fails at
 * startup instead of redirecting visitors somewhere unintended.
 */
export function siteHosts(env: NodeJS.ProcessEnv = process.env): SiteHosts | null {
  const origin = env.CANONICAL_ORIGIN?.trim() ?? '';
  const hosts = (env.LEGACY_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!origin && hosts.length === 0) return null;
  if (!origin) throw new Error('LEGACY_HOSTS needs CANONICAL_ORIGIN');
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('CANONICAL_ORIGIN must be an HTTP(S) origin');
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || !url.hostname
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) throw new Error('CANONICAL_ORIGIN must be an HTTP(S) origin');
  for (const host of hosts) {
    if (!hostnamePattern.test(host)) throw new Error('LEGACY_HOSTS must be hostnames separated by commas');
    // A host that redirects to itself would never answer.
    if (host === url.hostname) throw new Error('LEGACY_HOSTS must not name the host of CANONICAL_ORIGIN');
  }
  return { canonicalOrigin: url.origin, legacyHosts: [...new Set(hosts)] };
}

let cached: { signature: string; hosts: SiteHosts | null } | undefined;

/** The same reading for request handling: a malformed value moves nothing. */
function requestSiteHosts(env: NodeJS.ProcessEnv): SiteHosts | null {
  const signature = `${env.CANONICAL_ORIGIN ?? ''}\u0000${env.LEGACY_HOSTS ?? ''}`;
  if (cached?.signature !== signature) {
    let hosts: SiteHosts | null = null;
    try { hosts = siteHosts(env); } catch { /* Startup reports it. */ }
    cached = { signature, hosts };
  }
  return cached.hosts;
}

/** The configured canonical origin, or null where the site has one host and none is named. */
export function canonicalOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  return requestSiteHosts(env)?.canonicalOrigin ?? null;
}

/** The canonical origin when the request reached a legacy host, or null. The request never chooses the origin. */
export function movedOrigin(headers: HeaderReader, env: NodeJS.ProcessEnv = process.env): string | null {
  const hosts = requestSiteHosts(env);
  if (!hosts || hosts.legacyHosts.length === 0) return null;
  const host = requestHostname(headers);
  return host && hosts.legacyHosts.includes(host) ? hosts.canonicalOrigin : null;
}

// What a browser, an installed app or another server fetches from a host on its
// own: the API (a redirect to another host drops the bearer token), health
// checks, assets, the service workers and what they precache, the manifest,
// app-association files, the sign-in email template the Auth server reads, and
// the files written for crawlers, which name the canonical origin themselves.
const staysOnItsHost = /^\/(?:api|health|_next|icons|fonts|auth-emails|\.well-known|share-target)(?:\/|$)|^\/(?:sw\.js|push-sw\.js|manifest\.webmanifest|og(?:-[a-z]{2})?\.png|og\.svg|favicon\.ico|robots\.txt|sitemap\.xml|privacy\.css|theme\.css)$/;

/**
 * Where a page request that reached a legacy host is sent: the same path and
 * query on the canonical origin. Only someone opening a page moves. The
 * service worker of the legacy host still fetches its app shell there, which
 * keeps an installed app working where it was installed.
 */
export function legacyHostRedirect(
  request: { method: string; headers: HeaderReader; pathname: string; search: string },
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!request.pathname.startsWith('/') || staysOnItsHost.test(request.pathname)) return null;
  // Browsers say what a request is for; anything else that asks for a page is a link being followed.
  const mode = request.headers.get('sec-fetch-mode');
  if (mode !== null && mode !== 'navigate') return null;
  const origin = movedOrigin(request.headers, env);
  if (!origin) return null;
  const target = new URL(origin);
  target.pathname = request.pathname;
  target.search = request.search;
  return target.href;
}
