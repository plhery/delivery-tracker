import 'server-only';
import { movedOrigin, requestHostname } from './siteHosts';

export function analyticsConfiguration(env: NodeJS.ProcessEnv = process.env) {
  try {
    if (env.NODE_ENV !== 'production') return null;
    const endpoint = new URL(env.UMAMI_URL ?? '');
    const origin = new URL(env.UMAMI_APP_ORIGIN ?? '');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if ([endpoint, origin].some((url) => url.protocol !== 'https:' || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash)) return null;
    if (!uuid.test(env.UMAMI_WEBSITE_ID ?? '') || !uuid.test(env.UMAMI_IOS_WEBSITE_ID ?? '')) return null;
    return { endpoint: `${endpoint.origin}/api/send`, hostname: origin.hostname,
      webWebsite: env.UMAMI_WEBSITE_ID!, iosWebsite: env.UMAMI_IOS_WEBSITE_ID! };
  } catch { return null; }
}

/**
 * What a client is told. Clients only collect when the hostname is the one
 * they call, so a host the site moved from is answered with its own name:
 * installed apps that still call it keep reporting to the same properties.
 */
export function analyticsConfigurationFor(headers: Pick<Headers, 'get'>, env: NodeJS.ProcessEnv = process.env) {
  const configuration = analyticsConfiguration(env);
  const moved = configuration && movedOrigin(headers, env);
  const asked = requestHostname(headers);
  if (!configuration || !moved || !asked || new URL(moved).hostname !== configuration.hostname) return configuration;
  return { ...configuration, hostname: asked };
}
