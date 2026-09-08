# Usage analytics

The official deployment uses Umami 3.2 at `https://u.plhery.com`. The web and PWA
share the **Delivery Tracker** property; native uses **Delivery Tracker iOS**.
The dashboard is at `https://umami.plhery.com`. Web event data distinguishes
`platform=web` and `platform=pwa`; native sends `platform=ios`. `mode` distinguishes
anonymous, demo and account screens. Umami's visitor counts are estimates from
its rotating IP/user-agent session hashing, not registered accounts or installs.
No persistent identifier or account identity is supplied by either client.

## Configuration

Set these **runtime** environment variables in the deployment:

- `UMAMI_URL`: HTTPS origin of the public collector, without a path.
- `UMAMI_APP_ORIGIN`: HTTPS origin of this delivery instance.
- `UMAMI_WEBSITE_ID`: Umami UUID for the web/PWA property.
- `UMAMI_IOS_WEBSITE_ID`: Umami UUID for the native property.

All four are required, and collection is enabled only with `NODE_ENV=production`.
These are public identifiers, never API keys. `/api/analytics/config` is uncached
and exposes only these collection settings. Clients verify that the configured
hostname matches the service they are using. The web CSP adds only the configured
Umami origin to `connect-src`; no remote JavaScript is loaded. Leave configuration
unset for local builds, forks, staging and Coolify previews. Native simulators
and builds configured for local demo mode always disable collection.

Both clients use Umami's `/api/send` collection protocol. Queues are bounded to
30 pending events; requests time out after five seconds, failures are dropped,
and analytics never delay or fail user operations. Events are not persisted or
replayed after offline use. Session cache tokens live in memory only.

## Event catalog

[`shared/analytics.json`](../shared/analytics.json) is the authoritative allowlist
of screens, actions and API mappings. `npm run ios:resources` copies this catalog
into the native bundle. No action names are derived from user text.

- **Navigation:** welcome, sign-in, deliveries, passport, friends, parcel,
  invitation, account, add-parcel and notifications. Paths are virtual screen
  names, never actual URLs containing parcel IDs, auth codes or invite links.
- **Authentication:** Google sign-in and email-code attempts/results, successful
  authentication, sign-out, demo entry/exit.
- **Parcels:** add, rename, change carrier, archive, restore, permanent delete,
  per-parcel notification changes, refresh one/all, copy tracking, carrier link,
  paste, native scanner, shared input.
- **Discovery:** debounced search usage (no query), status/carrier filter changes,
  sorting, archive/filter opening, friends and stamp interaction.
- **Friends:** profile save, create/revoke/accept invitation, remove friend,
  disable friends, copy/share invitation.
- **Preferences and account:** language, appearance, notifications, native widget
  and Live Activity settings, account export/deletion, privacy notice, app opens,
  native foreground and notification/deep-link opens.

User API operations emit one final result after any authentication retry:
`outcome=success`, `error`, or `accepted` for a queued HTTP 202 action. Accepted
refresh events mean the server queued work, not that every carrier succeeded.
Automatic polling, carrier detection, token renewal, device-token registration,
and invitation previews are excluded. UI interactions use no outcome or
`started` when completion is controlled by the OS (for example native sharing).
Local demo parcel mutations never count as successful account API operations.

## Privacy and verification

No emails, account IDs, parcel IDs/labels/contents, tracking numbers, postcodes,
invitation codes, raw errors, search terms, query strings or referrers are sent.
Umami still receives the connection IP/user agent, basic device metadata and
language. Account's **Usage analytics** toggle disables further collection and
clears queued events; the web also honors DNT, GPC and `umami.disabled=1`.
See the public privacy notice for retention and controls.

Tests cover payload sanitization, configuration gating, opt-outs, queue bounds,
network failures, and the shared action mapping. To verify deployment, load the
public app, open a screen and exercise a harmless control; confirm page views
and the named event in the web property. Rebuild/install the native app to pick
up instrumentation; existing installations cannot gain new Swift code from a
server deployment. Do not test destructive account/parcel operations on real
user data. See Umami's [collection API](https://docs.umami.is/docs/api/sending-stats).
