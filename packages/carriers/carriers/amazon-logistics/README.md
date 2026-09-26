# Amazon Logistics

Amazon's own last-mile network for retail orders. Link-only: tracking lives behind the
customer's Amazon account, so the app links to Your Orders and never fetches. There is no
adapter, and sync marks these parcels unsupported without calling any tracker.

## Notes

- The link is `https://www.amazon.{marketplace}/gp/your-account/order-history`, with the
  marketplace derived from the number's prefix (`core/catalog/amazon.ts`).
- The number formats (European country prefix + 10 digits, or `TBA` + 12 digits) are shared
  with [`amazon-shipping`](../amazon-shipping/README.md), the publicly trackable SWA/MCF
  service. Detection resolves them here first. A parcel moves to `amazon-shipping` only
  after Amazon's public tracker returns a structured `SWA` or `MCF` reply for it; guessing
  the other way would show an account-only parcel as trackable.
- This folder's detection rule is the single Amazon number pattern: `core/detection/amazon`,
  `amazon-shipping` and the native clients all read it from the generated catalog.
- Pasted `track.amazon.*` links are recognised and the number is read from them, but the
  carrier is still decided by the `amazon-shipping` check.
- Only the typed number is stored. The app never asks for Amazon credentials or holds an
  Amazon session.

## Rejected approaches

- Scraping Your Orders with a stored session: it would mean holding the user's Amazon
  credentials or cookies.
- Universal providers: they need the same account access, so lookups fail and add latency.
- A separate number pattern for each Amazon folder: the format is genuinely shared, and two
  copies would drift.
