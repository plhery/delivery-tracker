# Friends

A small, private stamp collection shared by mutual invitation. There are no public profiles,
discovery, contact import, follower counts, leaderboards or delivery feed.

## What is shared

Joining is opt-in. The user picks a nickname and sees a live preview of exactly what
friends will see. Two switches (both on by default for a new profile) control:

- **Passport stats**: delivered count, average journey (rounded up to whole days) and
  earned Passport stamps.
- **"A parcel arrived this week"**: a coarse signal with no parcel or exact time.

Nothing else crosses the boundary: no parcel names or contents, tracking numbers, carriers,
locations, emails, photos, active shipments or ids.

## Invitations

- A link is `/i/<key>`: a random 16-character base64url key (96 bits), called
  `previewId` / `preview_id` for historical reasons. It lets you preview and accept one
  invitation, so treat it as a credential. It grants only the friendship, never account
  or parcel access.
- Links are single-use and expire after seven days. Creating a new link keeps older ones
  valid. **Cancel invitation links** (in your own Friends card) revokes all outstanding
  links without touching existing friends.
- Public previews (including social-card GETs and rate-limited POSTs) reveal only the
  sender's nickname and never consume the link. Pages send `Referrer-Policy: no-referrer`,
  clients strip the key from the address bar before sign-in, and analytics never records
  URLs or keys. Social platforms may cache previews on their side.
- A pending invitation survives sign-in, kept in sessionStorage on the web and
  UserDefaults on iOS, for up to seven days. Newcomers choose their sharing settings before
  accepting.
- Reopening an accepted link shows `already_accepted` or `already_friends` to the account
  that accepted it, and creates nothing new. Unavailable links stay closed.
- Older link formats (`/i/key#token`, `/invite?preview=hash#token`) still work.
- Personal Team iOS builds open links through the web page's "Open in iOS app" button;
  universal links need the Associated Domains entitlement.

Either friend can remove the connection. Turning Friends off deletes the profile,
invitations and both sides of every friendship, and account deletion cascades the same way.

## How it's enforced

- The database computes summaries from the owner's tracking events. Client-sent statistics
  are never accepted.
- Friend tables deny direct client access. The anonymous preview returns only the
  nickname of an unexpired invitation, and authenticated functions bind `auth.uid()` and
  return mutual friends only. Parcel RLS is unchanged.
- Friend data is network-only and never cached. It is cleared when the app goes to the
  background or the view closes, and a visible view refreshes every 60 s so privacy changes
  spread.
- Account export includes your own settings and your friends' nicknames and card ids,
  never their stats.

## Stamps

Twelve shareable stamps: the original four plus `acrossBorders`, `aroundWorld`,
`theRegular`, `rightNextDoor`, `worthTheWait`, `busyDoorstep`, `pickedUp` and
`homeForHolidays`. They're derived from all of the owner's events, archived parcels
included, and returned only when stats sharing is on.

- Country stamps need explicit country evidence. Registration scans, ambiguous state or
  canton codes, tied scans and returns don't count.
- Repeated delivery scans count once.
- Calendar stamps use UTC, since Friends doesn't know the owner's timezone, so they can
  differ from the local Passport near midnight.

## Demo

Demo friends are local fixtures that use the same response shapes. Nothing reaches a real
person, and demo settings hide the cancel-links action. If the backend is down, the UI says
so and never falls back to demo data.
