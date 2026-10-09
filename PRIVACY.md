# Peek privacy notice

Effective: 8 October 2026

Peek follows parcels, on the web and in its iPhone app. This notice says what
the official service at peektracker.com processes to do that. Peek does not
sell personal data, serve advertising, or use advertising analytics.

## Data the service processes

- Your email address, account ID, session metadata, authentication security
  events, the language your apps use, and basic Google profile data when you
  choose Google sign-in.
- Parcel labels, tracking numbers, carrier selection, tracking history, status,
  timestamps, the operational location a carrier attaches to each scan — the
  city, region, country, and the postcode or name of the depot, parcel shop or
  locker that performed the scan — plus sender or business names, pickup-point
  details, parcel weight and dimensions where the carrier provides them.
- What some carriers need besides the number, when you supply it: a delivery
  postcode, a private tracking link, or a reference that itself contains the
  postcode.
- Web Push subscription endpoints, encryption keys, browser user agent, native
  iPhone APNs device token, optional device name and locale, a random local
  installation identifier, ActivityKit push-to-start and per-activity update
  tokens, delivery acknowledgements, and delivery errors when you enable the
  corresponding notification or Live Activity setting.
- Whether you asked for an email when a parcel arrives and when you
  turned it on, the parcels you muted for it, and a record of each of these
  emails: the parcel, whether it told a delivery or a parcel ready for pickup,
  when it was sent and whether sending worked.
- The links you make to share a parcel or to follow one without an account, and
  what each link shows.
- What you answer when a parcel's page asks whether it is right: the answer,
  the reasons you pick and anything you write, with the parcel's tracking
  number and what the service showed for it. No account, link or device is
  stored with an answer.
- When your apps last loaded your parcels, to within five minutes. It decides
  how often the service asks carriers about them.
- A nickname, sharing choices, invitations and connections when you turn on
  Friends.
- Technical request data processed by the hosting, reverse-proxy, Auth, and mail
  infrastructure, such as IP address, timestamp, and user agent.
- Server diagnostic logs and Sentry error reports include parcel tracking
  numbers, carrier, synchronization outcomes, and error details to diagnose
  tracking failures. Sentry reports leave out the body, the query and the IP
  address of the request that failed. They may retain request and response
  headers, addresses shortened to their path, and bounded excerpts of carriers'
  responses, including personal data present in them.
- When the web app's own code fails in your browser, a Sentry error report: the
  error's message and stack, the page's address without its query, its fragment
  or a parcel link's id, and your browser's user agent. It goes through the
  service's own server, without your IP address, cookies or account, and with
  anything shaped like a tracking number, a key or an email address taken out
  of the message.

## Why and where data is processed

The service uses this data to authenticate you, store your delivery box, fetch
carrier updates, synchronize devices, send requested notifications, prevent
abuse, diagnose failures, and honor export or deletion requests. Following your
parcels, with what you switch on, is the service you ask for. Abuse limits,
diagnostics and usage analytics rest on a legitimate interest in keeping Peek
safe and working. The delivery email rests on your consent.

The app, its database and sign-in (self-hosted Supabase), its logs and its
analytics run on a server rented from netcup GmbH, in Germany. Requests reach
it through Cloudflare, which relays them and sees network metadata such as your
IP address. Google provides Google sign-in. Resend delivers the service's
emails, as described under "Emails".

Cloudflare Turnstile checks the browser or an in-app verification sheet when you start a new parcel lookup to
prevent automated abuse. It processes browser and network signals; Peek sends
only its verification token to Cloudflare, not your parcel inputs. See
[Cloudflare's Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/).
A successful check produces a proof kept for fifteen minutes in the current
tab's session storage, so reloading the page keeps it (in memory on the
iPhone). It is tied to the hostname and to a keyed hash of the network it was
made on. It also works on up to two other networks, as when your device moves
between Wi-Fi and mobile data; the service keeps keyed hashes of those networks
in memory only, and forgets them after the proof expires. Existing parcel
pages remain readable without a check. Daily account usage counters prevent
bulk lookups.
New requests clear counters older than seven days; deleting the account
removes its counters.

When enabled for paid Apple builds, App Attest verifies the app without a browser
check. Apple attests a key held on the device; Peek stores its public key,
identifier, assertion counter and last-use time to prevent replay and limit
anonymous lookups. New key registrations remove keys unused for ninety days and
their usage counters. New verified requests clear daily counters older than
seven days and expired challenges. Keys are not linked to accounts or parcel
inputs. Turnstile remains available when App Attest cannot be used.

To get a parcel's history, the service sends its tracking number to the
carrier. When needed, it also asks other carriers the number could belong to, a
carrier that takes the parcel over on its way, and universal tracking services
such as ParcelsApp, Ship24, 17TRACK and the Universal Postal Union. The
carriers and services it can ask are listed in the open-source
[Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper).
A postcode or private link you supply goes to the carrier it is for; ParcelsApp
also receives the postcode. Dachser's link shows more than the journey: the
service discards its sender, recipient, address, contact and document fields.

Browser push services receive encrypted Web Push messages; Apple processes
native notification and Live Activity payloads through APNs. Those Apple
payloads can contain a parcel label, carrier, status, location, and expected
delivery text, but Peek does not put the tracking number in them.

Error reports go to Sentry (Functional Software, Inc.), which stores them in
the United States for up to 90 days. Sentry is certified under the EU–US and
Swiss–US Data Privacy Frameworks, and its data processing addendum includes
standard contractual clauses.

Outside Switzerland and the European Union, data therefore goes to the United
States (Cloudflare, Google, Apple, Sentry, Resend and your browser's push
service) and to the countries of the carriers and tracking services asked
about a parcel.

The service places scan locations on its map itself, with
[GeoNames](https://www.geonames.org) place data (CC BY 4.0) and sorting-centre
locations from [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors (ODbL), kept on its own servers; no mapping service receives them.
When you tap Directions or Show on map for a pickup point, in the app or in an
email, Apple Maps or Google Maps receives that pickup point's name and address,
and nothing else about the parcel.

## Emails

Peek sends two kinds of email, both through Resend (Resend, Inc., United
States): the sign-in code you ask for and, only if you turn it on, an email
when a parcel is ready for pickup and one when it is delivered.

The delivery email is off until you turn it on under Settings › Notifications,
or accept the offer shown once after a delivery. It goes to the
address you sign in with and contains the name you gave the parcel, the
carrier, the time and a picture of the journey with its towns. For a parcel
ready for pickup, it also names the pickup point the carrier gave, with its
address and a link that opens it in Google Maps, as Directions or Show on map
does. It never contains the tracking number. It has no tracking pixel, no tracked links
and no remote images. Peek sends at most these two per parcel and nothing
else: no newsletter and no promotion.

These emails rest on your consent. Turn them off at any time with the same
switch, for one parcel in that parcel's notification settings, or with the
link in every email, which works without signing in and takes effect at once. That link
carries a token that tells the service which account it belongs to.

Resend receives your email address and the content of each email, and keeps
messages and delivery logs in the United States for 30 days. The transfer
relies on the EU–US Data Privacy Framework and on standard contractual clauses,
with their Swiss additions, in Resend's data processing agreement. Resend
publishes the companies that work on its behalf, such as Amazon Web Services,
at [resend.com/legal/subprocessors](https://resend.com/legal/subprocessors).

## Usage analytics

The official public web service and connected iPhone app send screen views and
named feature actions (including success/failure) to our self-hosted Umami at
`u.plhery.com`. This helps us understand which features work and where actions
fail. Events include the platform, demo/account/anonymous mode, language, and
basic browser/device information. Umami processes IP address and user agent to
derive approximate location and rotating visitor/session identifiers. We do not
send account IDs, email addresses, parcel labels, tracking numbers, delivery
postcodes, invitation codes, search text, full URLs, referrers, or error
messages. No analytics cookies or persistent analytics device identifiers are
created. Events are not linked to your Peek account.

The website sends nothing when your browser asks not to be tracked (Do Not
Track or Global Privacy Control) or when Umami's local opt-out is set. The
iPhone app has no setting for it. Historical analytics remain until operational
cleanup and cannot be selected by account when you export or delete it because
we do not send an account identifier. Local demo builds, simulators, and
unconfigured self-hosted deployments do not collect.

## Following a parcel without an account

You can follow a parcel without signing in. The service then stores its
tracking number, the carrier, a postcode or tracking link if the carrier needs
one, the tracking history, and a link to the parcel. No account, email address
or name is stored. A name you give the parcel stays in your browser or in the iPhone
app, and in the part of a link after `#`, which is not sent to the service.

Your device keeps a key that shows it made the lookup; the service stores only
a hash of that key. Anyone who has the link can see the parcel's status and
history, with the tracking number masked to its last characters.
Only the device holding the key sees the full number, can forget the parcel,
and can keep it after signing in. The postcode or tracking link you entered is
never shown through a link.

Your browser, or the iPhone app, keeps a list of the parcels you followed or opened this way: each
link, its key if this device made the lookup, the name you gave it and the last
tracking history it showed, so the parcel is still there offline. The list
stays on the device until the parcel is forgotten or kept in an account.

Apart from that list, it keeps the last five postcodes you entered for these
lookups, each with the carrier it was for, so the next parcel's postcode field
can start from yours. They stay on the device after the parcels are forgotten,
until you choose Forget this postcode beside one or clear the site's or the
app's data.

To limit abuse, the service counts lookups, and numbers it asked carriers
about, per day under a keyed hash of the network address and the date. The
address itself is not stored, and the counters are deleted after seven days.

The same number looked up by several people, with the same carrier and
details, is stored once; each lookup has its own link.

A lookup is forgotten 30 days after the parcel is delivered or returned, or
90 days after its last news (a scan, or the link being opened), or at once
when you ask from the device that made it. The parcel's data goes with its
last link. If you sign in and keep the parcel, it becomes part of your account.
Diagnostic logs and Sentry reports can retain its tracking number as described
above.

## Sharing a parcel and notifications for a link

You can share a parcel through its link, with or without an account. Anyone
who has the link sees the parcel's status and history. They never see a pickup
code, a postcode, the recipient's name or the name you gave the parcel, and
the tracking number stays masked unless you choose to show it. An app that
previews the link, a chat app for instance, gets the parcel's status, carrier
and estimate, never the number, a name or a place.

You can mark the link as a gift. Until the parcel is delivered, its viewers
then see no sender, weight, size or pickup point, the number stays masked, and
the scans made in the country the parcel comes from read "Left the sender"
with that country and no town.

You can stop sharing at any time. The link then only says that the parcel is
not shared anymore. A stopped link from an account is deleted 30 days later;
deleting the parcel or the account deletes its links at once.

The name of a parcel, a gift note and who a gift is from are never sent to the
service. They travel in the part of the link after `#` and stay in the
browsers of the people who have the link. The browser you share from remembers
what you chose to send along, until the parcel is forgotten on that device. A
gift's page shows its recipient none of it before the parcel is delivered.

Anyone who has a link can turn on notifications in their browser for that one
parcel, without an account. The service then stores that browser's Web Push
endpoint and encryption keys, its language, which updates to announce, and
whether the device that made the lookup turned notifications on. This is deleted when
the parcel is delivered or returned, when the browser turns notifications off
or its push subscription ends, when the link is forgotten, and, for everyone
but the device that made the lookup, when sharing is stopped. The notifications
carry the parcel's status and never its number or name; a gift's do not say
where it is before it arrives.

Your browser is asked for notifications, and creates its push subscription,
only when you choose "Turn on". Adding a delivery to your calendar makes a
calendar file in the browser; nothing is sent for it.

## Answering whether a parcel is right

A parcel's page can ask whether what it shows is right, or which carrier has a
parcel no carrier was found for. Answering is optional. An answer is stored
with the parcel's tracking number, its carrier, the status and latest scans the
service held at that moment, the app and language you answered in, and what you
write: a note, or a carrier's name and its tracking page. It is used to find
and fix what Peek shows wrongly.

An answer is stored without your account, the link you opened or anything
about your device. It therefore cannot be found from an account, is not part of
an export, and is not removed when the parcel or the account is deleted. Please
leave personal details out of a note. Every answer is deleted 90 days after it
was given. A gift's recipient is not asked.

Your browser, or the iPhone app, remembers that you answered, so coming back
from the carrier's site does not ask again about the same update. That stays on
the device.

## Friends is optional

Friends uses a nickname you choose, separate from your sign-in profile. There
is no public directory or contact upload. Only people you connect with through
a single-use invitation can see your friend card. Invitations expire after
seven days. Current invitation keys are stored in an access-restricted table
and removed when accepted or revoked. Anyone holding a link can preview your
nickname and choose to accept after signing in; the link is an invitation
credential. Older invitation formats use a separately hashed acceptance token.

You choose whether to share your delivered-parcel count, average journey
rounded up to whole days, and earned Passport stamps. A separate setting, off
by default, can show that a parcel arrived during the current week. Friends
never receive parcel contents, labels, tracking numbers, carriers, locations,
exact delivery times, or information about active shipments. Your email, Google
name and photo are not part of your friend card.

Preview your card before saving. Changes apply to the next refresh, at most a
minute while Friends is open. Friend cards are not saved for offline use.
Removing a connection revokes access on both sides; turning off Friends deletes
your friend profile, connections and invitations. Anyone who has already seen a
card could still have kept a screenshot or copy.

## Retention and control

Parcel data remains until you delete the parcel or the account. Archiving a
parcel only hides it from the active list and retains its history. The time
your apps last loaded your parcels is overwritten at each visit and deleted
with the account. Turning off
Live Activities or signing out removes that installation's ActivityKit tokens;
disabled browser endpoints, ordinary native device registrations, and delivery
acknowledgements may remain until account deletion or operational cleanup.
Infrastructure backups and security logs may persist for the limited retention
configured by their operator. The service's own logs are kept for 30 days and
Sentry reports for up to 90 days; both can retain a tracking number after its
parcel or account is deleted. The record of a delivery email goes with the
account; Resend deletes its own copy after 30 days.

Use **Download my data** in the account menu for a machine-readable export,
including your Friends profile and connections. Use **Delete account** to
permanently delete the Auth user and, with it, your parcels, tracking events,
shared links, browser subscriptions, native device registrations, delivery
acknowledgements, delivery email records, and your Friends profile, connections
and invitations. Deletion cannot remove data already sent to a carrier or data
a processor must retain for security or legal obligations.

The browser stores the Supabase session, application preferences, an offline
application shell, and an account-scoped offline parcel snapshot. A language
chosen in the app is also kept in a first-party cookie, so pages open in that
language; it contains only the language code. The iPhone app stores its session
in Keychain and a protected account-scoped parcel snapshot; it requests a
current APNs token from Apple instead of persisting that token locally. It
stores a random installation identifier and the independent Home Screen widget
and Live Activity preferences on the device. Either snapshot can include
tracking history, a private tracking link, a supplied delivery postcode, and a
reference that contains the delivery postcode. Signing out clears
account-scoped local state and ends Live Activities. Browser or
operating-system controls can clear app data, Live Activities, and notification
permissions.

## Security and contact

The service uses HTTPS, short-lived access tokens, rotating refresh tokens,
Postgres row-level security, rate limits, and server-only secret keys. No
internet service can promise absolute security.

Peek is a personal, non-commercial project run by Paul-Louis Hery, in
Switzerland ([plhery](https://github.com/plhery) on GitHub). To get a copy of
your data, have it corrected or deleted, or object to how it is used, write to
[privacy@peektracker.com](mailto:privacy@peektracker.com). You can also complain to
your data protection authority.

For a security concern, use GitHub's
[private vulnerability report](https://github.com/plhery/peek-delivery-tracker/security/advisories/new).
Do not include a real tracking number, delivery postcode, sign-in code, access
token or private tracking link in a public issue.

> This notice covers the official Peek service. A fork is run by someone else,
> who must publish their own notice.
