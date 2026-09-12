# Swiss Post Cargo

## Identity and scope

Swiss Post Cargo is Swiss Post's domestic freight and pallet arm (the network
also trades under the Hugger name). It moves groupage and pallet consignments
inside Switzerland, so the shipments tracked here are freight references rather
than the parcel numbers handled by the `swiss-post` folder. Numbers reach this
adapter only when the user picks the carrier by hand or pastes a Swiss Post
Cargo tracking link: no detection rule claims the format, which is a plain
6–40 character alphanumeric barcode or customer reference.

## Portals

| Portal | URL | Role |
| --- | --- | --- |
| Public track & trace | `https://apv.swisspost-cargo.com/public/trackandtrace/{trackingNumber}` | The page we link to, and the page whose anonymous endpoint we call. |
| Canary | `https://apv.swisspost-cargo.com/public/trackandtrace` | Credential-free reachability probe. |

The page is a single-page app; the data comes from
`https://eosapi.swisspost-cargo.com/api/trackandtrace/public`, which accepts an
anonymous `POST {"Identifier": "…"}` with no token, cookie or session.

## What we retrieve

Retained: shipment status and stage, the event history (timestamp, city,
description and the provider's status code), and the public tracking URL.

Discarded: the consignee name and address the endpoint returns next to the
history, and the `FullDescription` field, which carries internal operational
detail rather than the customer-facing wording.

Never requested: no proof-of-delivery, image or document endpoint is called.

## Tracking numbers

Six to forty characters, letters and digits, at least one digit; spaces, dots
and dashes are stripped and the value is upper-cased. The shape is too generic
to detect, so `carrier.json` carries no detection rule and `numbers.json` records
that the sample resolves to `unknown`. Samples live in `numbers.json`.

## How the adapter works

One step, `direct`. `SwissPostCargoTracker.fetch()` normalizes the number, posts
it to the anonymous endpoint with a 15 s timeout and a 2 MB cap, and hands the
JSON to `parseSwissPostCargoResponse()`.

The response carries a `Type` discriminator. `Type: 1` is an identifier lookup:
every shipment it returns must echo the requested identifier, and rows for other
identifiers are dropped. `Type: 2` is a reference lookup, where the echo is not
guaranteed and every returned shipment belongs to the query. Any other `Type` is
a schema error rather than a guess. `Data: null` is the endpoint's documented
"no such shipment" answer and becomes `NotFoundError`.

Events are deduplicated on (time, location, description, code), sorted newest
first, and capped at 100. Timestamps normally arrive as ISO-8601 with an
explicit offset; `dd.MM.yyyy HH:mm[:ss]` and `dd/MM/yyyy HH:mm:ss` fallbacks are
read in `Europe/Zurich`.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
| --- | --- | --- |
| registered | `NTF`; "annoncé", "registered", "angemeldet", "information received" | prior-art |
| accepted | `RFS`; "Shipment accepted" | fixture |
| in_transit | any code and wording no other rule claims | prior-art |
| out_for_delivery | `SCA`; "out for delivery", "en livraison", "in Zustellung", "in consegna" | prior-art |
| delivered | `DLV`, `POD`, `P40`, `IMG`, `SIG`; "Delivered", "livré", "zugestellt", "consegnato" | fixture (`DLV`) |
| failed_attempt | "échec", "failed", "not delivered", "non livré", "nicht zugestellt", "verzögert" | fixture |
| exception | "incident", "refusé", "damage" | prior-art |
| returned | "retour", "return", "zurück" | prior-art |
| pending | not observed; reported as unmapped | — |
| customs | not observed; reported as unmapped | — |
| ready_for_pickup | not observed; reported as unmapped | — |

Full entries, with dates, are in `statuses.json`.

## Limitations and privacy

No estimated delivery date is exposed by this endpoint, so `expected_delivery`
is always `null`. Freight consignments can span several shipment rows; the
adapter merges their histories and keeps the newest 100 events. A response whose
rows carry no usable event at all is a schema error rather than an empty
success, so a broken shape cannot look like a parcel with no news yet.

The endpoint needs no credential, so nothing about the lookup is secret. The
consignee block it returns is never projected, never logged and never written to
a fixture.

## Implementation decisions

- 2026-08-30: call the anonymous JSON endpoint the official tracker itself
  calls, rather than scraping the single-page app. The endpoint takes no token
  or cookie, so there is no session to keep alive and no challenge to solve.
- 2026-08-30: treat `Data: null` as not found and anything else unexpected as a
  schema error. The endpoint answers HTTP 200 for unknown identifiers, so the
  status code alone cannot tell the two apart.
- 2026-08-30: require the echoed identifier for `Type: 1` responses and accept
  every returned row for `Type: 2`. A reference lookup legitimately returns
  shipments whose identifier differs from the query; an identifier lookup does
  not.
- 2026-08-30: classify negative wording (return, incident, failure) before the
  delivery words. Rows such as "Not delivered" contain "delivered" as a
  substring, and mislabelling one as a delivery ends the parcel's tracking.
- 2026-09-12: the status map moved to `status.ts` unchanged, and the inline
  delivered payload moved to `fixtures/delivered.json`. `SwissPostCargoTrackingError`
  became `NotFoundError('Swiss Post Cargo')`; the message and HTTP-like status
  404 are identical, so the host's unannounced-parcel handling is unaffected.

## Rejected alternatives

- Reading the public page's HTML: the page renders client-side, so this would
  mean running a browser for data the endpoint returns directly.
- `core/time`'s `isoTime()` for event timestamps: it stamps offset-less ISO
  values with a zone. Keeping luxon's `setZone` reading means an unexpected
  offset-less value is never silently relabelled as Swiss local time. The
  `dd.MM.yyyy` fallbacks are read in `Europe/Zurich`, which is stated in the
  helper's comment.
- Reporting an empty shipment as a pending parcel: a response with rows but no
  usable event proves nothing about the shipment, so it stays a schema error.


## Verification log

- 2026-08-30: protocol read from the public tracker's own published source map
  (`907.9a0b939a.chunk.js.map`); confirmed the anonymous `POST {Identifier}`
  call and that a `null` `Data` property is the clean not-found answer.
- 2026-08-30: the official tracking form at `portal-de1.swisspost-cargo.com/Track`
  labels `12345678` as its own example ("z.B."); the live test uses it.
- 2026-09-12: adapter moved into this folder; the status map moved to
  `status.ts` and the payload to `fixtures/delivered.json` unchanged.
