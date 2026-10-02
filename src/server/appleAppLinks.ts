import 'server-only';

const appIdPattern = /^[A-Z0-9]{10}\.[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/;

/**
 * The iPhone apps allowed to open this site's links: `APPLE_APP_IDS`
 * (`<team>.<bundle id>`, separated by commas), or the app that receives the
 * push notifications when that is configured.
 */
export function appleAppIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const listed = (env.APPLE_APP_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const team = env.APNS_TEAM_ID?.trim();
  const bundle = env.APNS_BUNDLE_ID?.trim();
  const ids = listed.length > 0 ? listed : team && bundle ? [`${team}.${bundle}`] : [];
  return [...new Set(ids.filter((id) => appIdPattern.test(id)))];
}

/**
 * The association file iOS reads from `/.well-known/apple-app-site-association`
 * before it opens a link in the app: parcel links and friend invitations, and
 * nothing else. Null when no app is configured.
 */
export function appleAppSiteAssociation(env: NodeJS.ProcessEnv = process.env) {
  const appIDs = appleAppIds(env);
  if (appIDs.length === 0) return null;
  return {
    applinks: {
      details: [{
        appIDs,
        // Parcel links, friend invitations, and invitations in their older form.
        components: [{ '/': '/p/*' }, { '/': '/i/*' }, { '/': '/invite' }],
      }],
    },
  };
}
