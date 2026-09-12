# C Chez Vous notes

## Decisions

- The page is parsed rather than a hidden API called: the record the frontend
  renders is already embedded in the HTML, so one bounded `GET` gets everything
  with no session, token or second request. One `direct` step.
- The order reference is checked twice — against the embedded `package_number`
  and against the reference printed in the heading — because the page is a
  single-page app shell and a stale or generic render would otherwise pass as a
  result for the wrong order.
- The order's step is the **least advanced** of its parcels. An order with one
  delivered and one still-preparing parcel is not delivered, and reporting it as
  delivered would stop notifications for the rest of it.
- Only the calendar day of the appointment is kept. `dateMessage` ("Entre 08h00
  et 13h00") is a fact about the recipient's day, and the offline test asserts it
  never reaches the result.
- `history` is not declared as a capability even though the result has an
  `events` array. The page has no scan history; the single event restates the
  current step, and declaring a capability the adapter cannot really deliver
  would make the capability list meaningless.
- 2026-09-12: a `parcelStep` outside 1–5 is no longer clamped to step 1. It used
  to report "Commande enregistrée", which claims an order has not started — a
  statement we cannot make about a step the provider just introduced. Such an
  order is now reported as unknown, with no stage, so the sync classifies it and
  records it for review.

## Rejected alternatives

- Reading `parcels[].pickupName`, `address`, `mail` or `mobile` for a richer
  status line: they are recipient identity and contact data, which `PRIVACY.md`
  forbids retaining.
- Keeping `articles` to label the shipment: order contents are customer data and
  are never retained.
- Declaring `pickup_point`: `pickupName` is the person receiving the order, not
  a parcel shop, despite the field name.
- Treating the redirect to the tracking form as a transport failure: it is the
  provider's stable way of saying it does not know the order, so it is a
  not-found.

## Verification log

- 2026-09-12: moved from `src/server/cChezVous.ts` into this folder.
  `CChezVousTrackingError` replaced by `NotFoundError('C Chez Vous')` (same
  message and status; nothing outside the folder referenced the old class), and
  parse failures replaced by `SchemaError`.
- 2026-09-12: `FGRC45BKLM` and `4TZKO156790--59600`, both printed by C Chez Vous
  under its own tracking form, are retired orders and redirect back to the form.
