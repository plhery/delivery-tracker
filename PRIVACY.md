# Peek privacy notice

Effective: 12 September 2026

This notice describes the official Peek parcel-tracking service.
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
  delivery postcodes you supply for carriers that require or accept
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
but Peek does not put the tracking number in them.

The service places scan locations on its map itself, with GeoNames place data
(CC BY 4.0, geonames.org) and sorting-centre locations from OpenStreetMap contributors
(ODbL, openstreetmap.org/copyright), kept on its own servers; no mapping service receives them.
When you tap Directions or Show on map for a pickup point, Apple Maps or Google
Maps receives that pickup point's name and address, and nothing else about the parcel.

Peek does not sell personal data, serve advertising, or
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
Events are not linked to your Peek account.

Turn off **Usage analytics** in Account on each device to stop collection.
The web client also honors Do Not Track, Global Privacy Control and Umami's
local opt-out. Queued events are discarded when you opt out. Historical analytics
remain until operational cleanup and cannot be selected by account when you
export or delete it because we do not send an account identifier. Local demo
builds, simulators, and unconfigured self-hosted deployments do not collect.

## Following a parcel without an account

You can follow one parcel without signing in. The service then stores its
tracking number, the carrier, a postcode or tracking link if the carrier needs
one, the tracking history, and a link to the parcel. No account, email address
or name is stored. A name you give the parcel stays in your browser and in the
part of a link after `#`, which browsers do not send to the service.

Your device keeps a key that shows it made the lookup; the service stores only
a hash of that key. Anyone who has the link can see the parcel's status and
history, with the tracking number masked to its first and last characters.
Only the device holding the key sees the full number, can forget the parcel,
and can keep it after signing in. The postcode or tracking link you entered is
never shown through a link.

Your browser keeps a list of the parcels you followed or opened this way: each
link, its key if this device made the lookup, the name you gave it and the last
tracking history it showed, so the parcel is still there offline. The list
stays on the device until the parcel is forgotten or kept in an account.

To limit abuse, the service counts lookups per day under a keyed hash of the
network address and the date. The address itself is not stored, and the
counters are deleted after seven days.

The same number looked up by several people, with the same carrier and
details, is stored once; each lookup has its own link.

A lookup is forgotten 30 days after the parcel is delivered or returned, or
90 days after its last news (a scan, or the link being opened), or at once
when you ask from the device that made it. The parcel's data goes with its
last link. If you sign in and keep the parcel, it becomes part of your account.
Diagnostic logs and Sentry reports can retain its tracking number as described
above.

## Sharing a parcel and alerts for a link

You can share a parcel through its link, with or without an account. Anyone
who has the link sees the parcel's status and history. They never see a pickup
code, a postcode, the recipient's name or the name you gave the parcel, and
the tracking number stays masked unless you choose to show it.

You can mark the link as a gift. Until the parcel is delivered, its viewers
then see no sender, weight, size or pickup point, the number stays masked, and
the scans made in the country the parcel comes from read "Left the sender"
with that country and no town.

You can stop sharing at any time. The link then only says that the parcel is
not shared anymore. A stopped link from an account is deleted 30 days later;
deleting the parcel or the account deletes its links at once.

The name of a parcel, a gift note and who a gift is from are never sent to the
service. They travel in the part of the link after `#` and stay in the
browsers of the people who have the link.

Anyone who has a link can turn on notifications in their browser for that one
parcel, without an account. The service then stores that browser's Web Push
endpoint and encryption keys, its language, which updates to announce, and
whether the device that made the lookup turned the alert on. This is deleted
when the parcel is delivered or returned, when the browser turns the alert off
or its push subscription ends, when the link is forgotten, and, for everyone
but the device that made the lookup, when sharing is stopped. The notifications
carry the parcel's status and never its number or name; a gift's do not say
where it is before it arrives.

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
application shell, and an account-scoped offline parcel snapshot. A language
chosen in the app is also kept in a first-party cookie, so pages open in that
language; it contains only the language code. The iPhone app
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
