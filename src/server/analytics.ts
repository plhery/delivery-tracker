import 'server-only';

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
