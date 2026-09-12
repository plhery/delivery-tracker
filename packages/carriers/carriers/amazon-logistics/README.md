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

## Verification log

- 2026-09-10: confirmed that the shared format resolves here first and that a
  parcel only becomes `amazon-shipping` after the public tracker returns a
  structured `SWA` or `MCF` response, verified independently by the create and
  carrier-change APIs.
- 2026-09-12: folder documented alongside the `amazon-shipping` adapter move.
