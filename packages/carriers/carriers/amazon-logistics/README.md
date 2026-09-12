# Amazon Logistics

## Identity and scope

Amazon Logistics (AMZL) is Amazon's own last-mile delivery network for retail
orders. It shares its tracking-number formats with Amazon Shipping — a
recognized European country prefix followed by ten digits, or `TBA` followed by
twelve digits — so the same string can belong to either. The catalog resolves
the format to this carrier first; see `../amazon-shipping/` for the
public-tracking half and the verification that moves a parcel there.

## Portals

| Portal | URL | Role |
| --- | --- | --- |
| Amazon Your Orders | `https://www.amazon.{marketplace}/gp/your-account/order-history` | The page we link to. The marketplace is derived from the number's prefix. |

`track.amazon.*` links pasted by a user are recognized as Amazon links and the
number is read out of them, but the carrier is then decided by the Amazon
Shipping verification, not by the link.

## What we retrieve

Nothing. This carrier is `link-only`: retail Amazon Logistics tracking lives
behind the customer's Amazon account, so the app links to Your Orders and
explains the limitation instead of fetching. Sync marks these parcels
unsupported without calling a direct or a universal tracker.

## Tracking numbers

One detection rule, shared with Amazon Shipping and used as the single source
of the Amazon number pattern for the whole package: `core/detection/amazon`
reads it from this folder's `carrier.json`. Samples live in `numbers.json`.

## How the adapter works

There is no adapter. `tracking.mode` is `link-only` and `tracking.adapter` is
`null`, so the generated registry maps this carrier to `null` and the host never
attempts a lookup.

## Status reference

Not applicable: no status is ever retrieved.

## Limitations and privacy

Account-only by design. The app never asks for Amazon credentials, never signs
in on the user's behalf, and stores no Amazon account data — the only thing kept
is the tracking number the user typed, which is used to build the Your Orders
link and to run the Amazon Shipping check.

## Implementation decisions

- 2026-09-10: keep this carrier link-only. Retail Amazon Logistics tracking is
  behind the customer's Amazon account; there is no anonymous endpoint to call,
  and asking users for Amazon credentials is not something this app does.
- 2026-09-10: resolve the shared number format here first, then let the Amazon
  Shipping check promote a parcel to `amazon-shipping`. Guessing the other way
  round would present an account-only parcel as publicly trackable.
- 2026-09-10: hold the Amazon number pattern in this folder's single detection
  rule and read it from the generated catalog, so `amazon-shipping`,
  `core/detection` and the native clients all use one pattern.
- 2026-09-12: folder given a README and these notes while the `amazon-shipping`
  adapter moved into its own folder. No behaviour changed here.

## Rejected alternatives

- Scraping Your Orders with a stored session: it would mean holding the user's
  Amazon credentials or cookies, which this app does not do.
- Routing these numbers through a universal provider: the aggregators need the
  same account access, so the lookup fails and only adds latency and noise.
  Sync marks the parcel unsupported instead.
- Giving the carrier its own number pattern: the format is genuinely shared with
  Amazon Shipping, and two copies would drift.


## Universal provider compatibility

Probed 2026-09-12 with the corpus number `TBA333656997000` (shipment, `public_shipment_report`, [source](https://github.com/jkeen/tracking_number_data/issues/2)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404; account-only by design |
| ParcelsApp | ❌ No usable history — sign-in notice only |
| 17TRACK | ❌ No usable history — lookup still polling at budget end (code 100); account-only by design (2026-09-13) |

## Verification log

- 2026-09-10: confirmed that the shared format resolves here first and that a
  parcel only becomes `amazon-shipping` after the public tracker returns a
  structured `SWA` or `MCF` response, verified independently by the create and
  carrier-change APIs.
- 2026-09-12: folder documented alongside the `amazon-shipping` adapter move.
- 2026-09-12: universal-provider probe with corpus number `TBA333656997000`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: incompatible by design.
- 2026-09-13: 17TRACK probe with corpus number `TBA333656997000` via prod TRAWL: no usable history (lookup still polling; account-only).
