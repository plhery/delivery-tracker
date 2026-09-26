# Usage analytics

Optional, self-hosted [Umami](https://umami.is). Web and PWA share one property (tagged
`platform=web` or `platform=pwa`); the iPhone app uses a second one (`platform=ios`).
`mode` separates anonymous, demo and account screens. Neither client sends a persistent
identifier or account identity, so visitor counts are Umami's own estimates.

## Configuration

Runtime environment variables, all four required:

| Variable | Value |
| --- | --- |
| `UMAMI_URL` | HTTPS origin of the collector, no path |
| `UMAMI_APP_ORIGIN` | HTTPS origin of this instance |
| `UMAMI_WEBSITE_ID` | Umami id of the web/PWA property |
| `UMAMI_IOS_WEBSITE_ID` | Umami id of the iPhone property |

Collection only runs with `NODE_ENV=production`. Leave these unset for local builds,
forks, staging and previews. Simulators and demo builds never send events.

The values are public ids, not keys. Clients read them from the uncached
`/api/analytics/config` and check the hostname. The CSP allows only that origin in
`connect-src`, and no remote script is loaded.

Both clients post to Umami's `/api/send`. The queue holds at most 30 events, and requests
time out after 5 s. Failures are dropped and never delay the user; nothing is stored for
offline replay. The iPhone app uses a Safari-like user agent with a `DeliveryTracker`
suffix, because Umami drops bare app user agents as bots.

## Events

[`shared/analytics.json`](../shared/analytics.json) is the allowlist of screens, actions
and API mappings. `npm run ios:resources` copies it into the iPhone bundle. Screen paths
are virtual names, never real URLs.

- **Navigation**: welcome, sign-in, deliveries, passport, friends, parcel, invitation,
  account, add-parcel, notifications.
- **Auth**: sign-in attempts and results, sign-out, demo entry/exit.
- **Parcels**: add, rename, change carrier, archive, restore, delete, mute, refresh, copy,
  open carrier link, paste, scan, share-in.
- **Discovery**: search used (never the query), filters, sorting.
- **Friends**: profile save, invitation create/revoke/accept/share, remove, disable.
- **Settings**: language, appearance, notifications, widgets, Live Activities, export,
  account deletion, app opens.

API actions report one final `outcome`: `success`, `error`, or `accepted` for a queued
(HTTP 202) request. `accepted` means the work was queued, not that carriers answered.
Background polling, detection, token renewal and invitation previews aren't tracked.
Demo actions never count as account API successes.

## Privacy

Never sent: emails, account or parcel ids, labels, tracking numbers, postcodes, invitation
codes, errors, search terms, query strings or referrers. Umami still sees the IP, user
agent, basic device data and language.

The **Usage analytics** switch in Account turns collection off and clears the queue. The
web also honours DNT, GPC and `umami.disabled=1`. Retention is described in the public
privacy notice.

To check a deployment, open the app, change a harmless setting, and confirm the page view
and event in Umami. iPhone changes need a new app build.
