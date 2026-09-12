# Delivery Tracker privacy notice

Effective: 12 September 2026

This notice describes the official Delivery Tracker parcel-tracking service.
A third party running a fork controls its own deployment and must publish its
own notice.

## Data the service processes

- Your email address, Supabase user ID, session metadata, authentication
  security events, and basic Google profile data when you choose Google sign-in.
- Parcel labels, tracking numbers, carrier selection, tracking history, status,
  timestamps, the operational location a carrier attaches to each scan — the
  city, region, country, and the postcode or name of the depot, parcel shop or
  locker that performed the scan — plus sender or business names, pickup-point
  details, parcel weight and dimensions where the carrier provides them.
- Optional Planzer shared and Dachser Customer Iberia capability URLs,
  supplied delivery postcodes for carriers that require
  them, and combined tracking credentials that can contain a delivery postcode.
- Web Push subscription endpoints, encryption keys, browser user agent, native
  iPhone APNs device token, optional device name and locale, a random local
  installation identifier, ActivityKit push-to-start and per-activity update
  tokens, delivery acknowledgements, and delivery errors when you enable the
  corresponding notification or Live Activity setting.
- Technical request data processed by the hosting, reverse-proxy, Auth, and mail
  infrastructure, such as IP address, timestamp, and user agent.
- Your chosen nickname, sharing preferences, invitations, connections and
  selected delivery statistics when you enable Friends. Current invitation keys
  are stored in an access-restricted table, expire after seven days, and are
  removed when accepted or revoked. A link holder can preview your nickname and
  choose to accept after signing in. Friends do not receive private parcel
  details or tracking numbers.
- Server diagnostic logs and Sentry error reports include parcel tracking
  numbers, carrier, synchronization outcomes, and error details to diagnose
  tracking failures. Sentry may retain original request/response headers, URLs
  and bounded body excerpts, including personal data and session or
  authentication information present in those diagnostics. The application does
  not apply field-based redaction to these error reports.

## Why and where data is processed

The service uses this data to authenticate you, store your delivery box, fetch
carrier updates, synchronize devices, send requested notifications, prevent
abuse, diagnose failures, and honor export or deletion requests.

Supabase processes authentication and database requests. Google provides social
sign-in, and the configured SMTP provider delivers sign-in codes when email OTP
is enabled. Cloudflare and the container host may process network metadata. A
selected carrier necessarily receives its tracking number or carrier-specific
tracking credential. Fallback tracking providers (Ship24, ParcelsApp and
17TRACK, plus Postal Ninja when enabled) also receive the tracking number when
used. ParcelsApp additionally receives the stored delivery postcode when one is
supplied. DPD Switzerland may also receive the parcel's supplied
postcode for recipient verification. Mondial Relay requires the five-digit
recipient postcode to retrieve shipment events. Colis Privé receives a combined
credential made from its 12-character shipment number and the five-digit
delivery postcode. Planzer receives the supplied shared-link capability. Dachser
receives its supplied capability URL; the application discards sender,
recipient, address, contact and document fields from Dachser's response. Browser
push services receive encrypted Web Push messages; Apple processes native
notification and Live Activity payloads through APNs. Those Apple payloads can
contain a parcel label, carrier, status, location, and expected delivery text,
but Delivery Tracker does not put the tracking number in them.

Delivery Tracker does not sell personal data, serve advertising, or
use advertising analytics.

## Usage analytics

The official public web service and connected iPhone app send screen views and
named feature actions (including success/failure) to our self-hosted Umami at
`u.plhery.com`. This helps us understand which features work and where actions
fail. Events include the platform, demo/account/anonymous mode, language, and
basic browser/device information. Umami processes IP address and user agent to
derive approximate location and rotating visitor/session identifiers. We do not
send account IDs, email addresses, parcel labels, tracking numbers, delivery
postcodes, invitation codes, search text, full URLs, referrers, or error messages.
No analytics cookies or persistent analytics device identifiers are created.
Events are not linked to your Delivery Tracker account.

Turn off **Usage analytics** in Account on each device to stop collection.
The web client also honors Do Not Track, Global Privacy Control and Umami's
local opt-out. Queued events are discarded when you opt out. Historical analytics
remain until operational cleanup and cannot be selected by account when you
export or delete it because we do not send an account identifier. Local demo
builds, simulators, and unconfigured self-hosted deployments do not collect.

## Retention and control

Parcel data remains until you delete the account. Archiving a parcel only hides
it from the active list and retains its history. Turning off Live Activities or
signing out removes that installation's ActivityKit tokens; disabled browser
endpoints, ordinary native device registrations, and delivery acknowledgements
may remain until account deletion or operational cleanup. Infrastructure backups
and security logs may persist for the limited retention configured by their
operator. Server diagnostic logs and Sentry reports can retain tracking numbers
after a parcel or account is deleted, until their configured retention expires.

Use **Download my data** in the account menu for a machine-readable export. Use
**Delete account** to permanently delete the Auth user and cascade-delete their
parcels, tracking events, browser subscriptions, native device registrations,
and delivery acknowledgements.
Deletion cannot remove data already sent to a carrier or data a processor must
retain for security or legal obligations.

The browser stores the Supabase session, application preferences, an offline
application shell, and an account-scoped offline parcel snapshot. The iPhone app
stores its session in Keychain and a protected account-scoped parcel snapshot;
it requests a current APNs token from Apple instead of persisting that token
locally. It stores a random installation identifier and the independent Home
Screen widget and Live Activity preferences on the device. Either snapshot can
include tracking history, a carrier capability URL, a supplied delivery
postcode, and a combined tracking credential that can contain the delivery
postcode. Signing out clears account-scoped local state and ends
Live Activities. Browser or operating-system controls can clear app data, Live
Activities, and notification permissions.

## Security and contact

The service uses HTTPS, short-lived access tokens, rotating refresh tokens,
Postgres row-level security, account-scoped rate limits, and server-only secret
keys. No internet service can promise absolute security.

For a privacy or security concern, use GitHub's
[private vulnerability report](https://github.com/plhery/delivery-tracker/security/advisories/new).
Do not include a real tracking number or combined tracking credential, delivery
postcode, sign-in code, access token, Planzer shared link, or Dachser detail
link in a public issue.
