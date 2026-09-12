# Swiss Post

## Identity and scope

Swiss Post (Die Post / La Poste Suisse / La Posta Svizzera) is Switzerland's
universal postal operator and the country's largest parcel carrier; it also
delivers in Liechtenstein. This folder covers both the domestic parcel network
and inbound international letter-post, which is how most cross-border parcels
finish their journey — including the AliExpress/Cainiao handoff, where a tracked
`L…CH` letter-post number is checked against Swiss Post before every sync and
becomes the primary source as soon as Swiss Post has a usable record.

## Portals

| Portal | URL | Role |
| --- | --- | --- |
| Public tracking | `https://service.post.ch/ekp-web/ui/entry/search/{trackingNumber}` | The page we link to, and the app whose API we call. |
| Canary | `https://service.post.ch/` | Credential-free reachability probe. |

## What we retrieve

Retained: shipment status and stage, the raw `globalStatus`, the event history
(the carrier's own timestamp string, the scan city and postcode, the translated
wording and the full dotted event code), the delivery estimate or window, the
canonical Swiss Post shipment number and the international barcode when the
carrier echoes one.

Discarded: recipient name, delivery address, signature and delivery
instructions, and the internal `identity` handle used to request events.

## Tracking numbers

Two high-confidence shapes: S10 (`[A-Z]{2}` + 9 digits + `CH`, check digit
validated) and the 18-digit domestic form starting `98` or `99`. Both are
catalogued in `carrier.json`; samples live in `numbers.json`. Numbers are
compared after stripping spaces, dots and dashes and upper-casing, so the
dotted form the portal prints (`99.34.123456.12345678`) matches what a user
types.

## How the adapter works

One step, `direct`, but four chained requests behind one cookie jar, because the
tracker signs an anonymous visitor in before it will search:

1. `GET /api/user` creates a throwaway user and returns an `x-csrf-token`.
2. `POST /api/history?userId=…` with the search query returns a result `hash`.
3. `GET /api/history/not-included/{hash}?userId=…` returns the shipments.
4. `GET /api/shipment/id/{identity}/events` returns that shipment's scans.

Each call is bounded at 10 s. Step 4 is optional: if it fails, the shipment
summary is still returned, because a summary is more useful than an error.

An empty array from step 3 is the carrier's clean not-found. Otherwise exactly
one returned shipment must match the requested number, on either its own
`shipmentNumber` or its `internationalBarcode` — two matches are an ambiguous
shipment and none is a different shipment, both refused rather than guessed.

Event wording comes from the service's own translation table, fetched once per
process and only when there are events to translate. Keys are dotted patterns
with `*` wildcards (`PARCEL.*.1.1003.INLAND`); the most specific pattern of the
same length wins, and `INLAND`/`IMPORT`/`EXPORT` is chosen from the shipment's
own international flags. A sub-event adds a detail suffix after an em dash.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
| --- | --- | --- |
| registered | `600`; `LETTER.*.90.620`; `REPORTED`, `REGISTERED` | fixture |
| accepted | `LETTER.*.90.912` | fixture |
| in_transit | `820`, `1201`, `1202`; `LETTER.*.90.{804,805,818,915,1001,1213,1218}`; `TO_BE_DELIVERED`, `CUSTOMS` | fixture |
| out_for_delivery | `1003`; `IN_DELIVERY` | fixture |
| ready_for_pickup | `2102` (MyPost24 deposit) | fixture |
| delivered | `4600`; `DELIVERED` | fixture |
| customs | `LETTER.*.90.803` | fixture |
| failed_attempt | `MISSED_DELIVERY`, `NOT_DELIVERED` (shipment level only) | prior-art |
| returned | `3600`; `RETURNED` | prior-art |
| pending | not an event stage; announcements are reported as `registered` | — |

Any other event code is deliberately left without a stage: the event keeps its
translated wording and its raw code, and the sync classifies and records it.
Full entries are in `statuses.json`.

## Limitations and privacy

Event timestamps are kept exactly as the carrier sends them, and are parsed only
to sort — an offset-less value is read as UTC for that comparison alone, never
rewritten. The declared timezone is `Europe/Zurich`.

Scan locations keep the facility's city **and postcode**. On a final delivery
scan that postcode is the delivery area's, so it is coarser than a street but
not nothing; it is retained because it is what distinguishes two same-named
towns in the history. No recipient name, street, signature or delivery
instruction is ever projected.

The lookup needs no credential: the anonymous user, CSRF token and search hash
are created per call and discarded with the cookie jar.

## Verification log

- 2026-09-10: the ten `LETTER.*.90.*` import scan codes were confirmed against
  their English wording; `804`/`805` mean clearance *completed* and `1001` means
  arrival at the collection point, neither of which is a delivery.
- 2026-09-12: adapter moved into this folder; the status tables moved to
  `status.ts` and the shipment payload to `fixtures/out-for-delivery.json`.
  `SwissPostTrackingError` became `NotFoundError('Swiss Post')` — same message,
  same 404 status. The catalog still records `tracking.adapter: "upstream"`;
  the generated registry now resolves this carrier to its own folder because
  `adapter.ts` exists, which is the intended outcome.
