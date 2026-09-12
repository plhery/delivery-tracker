# Hermes Einrichtungs-Service

## Identity and scope

Hermes Einrichtungs-Service (HES) is the two-man handling arm of the Hermes
group: furniture, white goods and other bulky items delivered into the home by
appointment, in Germany. It is a different company and a different tracking
system from Hermes Germany's parcel network — see the `hermes-de` folder for
that one. Nothing about the two number formats overlaps in our catalog, and no
detection rule claims the HES consignment format, so parcels reach this adapter
only when the user picks the carrier by hand.

## Portals

| Portal | URL | Role |
| --- | --- | --- |
| Customer portal | `https://myhes.de/` | The page we link to. It is an appointment portal rather than a per-number tracking page, so the catalog carries no `{trackingNumber}` template. |
| Canary | `https://myhes.de/` | Credential-free reachability probe. |

The data comes from `https://myhes.de/api/request/auftragsdaten?parcelNumber=…`,
an anonymous JSON lookup keyed on the consignment ("Lieferschein") number.

## What we retrieve

Retained: order status, the customer-facing timeline (booking timestamp, German
status wording and the stage it maps to) and the delivery date or appointment
window as the estimate.

Discarded: `versenderdaten` (the sending retailer), the recipient block, and
`abstellgenehmigung` (the customer's drop-off permission — a delivery
instruction). The response also carries a second, internal operational stream
(`statusdaten`) with duplicate scans; it is deliberately ignored, because the
carrier's own UI shows `auftragstatusdaten` and only that.

Unavailable: the API attaches no scan location to timeline rows, so every event
carries an empty location.

## Tracking numbers

The consignment number is the Lieferschein number printed on the delivery note:
digits, commonly 8–9 or 17 characters. Spaces, dots and dashes are stripped and
the value is upper-cased before it is compared with the number the API echoes.
The shape is too generic for a detection rule, so `numbers.json` records that
the sample resolves to `unknown` with `dhl-ecommerce` as a candidate.

## How the adapter works

One step, `direct`. `HermesTracker.fetch()` calls the anonymous endpoint with a
15 s timeout, then `parseHermesTrackingResponse()` projects it.

Identity first: the response must echo the requested Lieferschein number, or the
lookup is a schema error rather than someone else's order. The API answers a
valid but unknown number with a *synthetic* order whose `auftragId`,
`auftragsart` and `statusjourneyDto` are all `null`; that placeholder becomes
`NotFoundError` instead of a pending parcel that would never move.

Timeline rows without both wording and a booking timestamp are dropped, the rest
are sorted newest first by their raw timestamp string, and the newest row sets
the shipment status.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
| --- | --- | --- |
| registered | `40` | prior-art |
| in_transit | `100`, `190`, `300`, `307`, `314`, `315`, `500` | prior-art |
| out_for_delivery | `430`; "befindet sich auf Tour", "Fahrzeugbeladung", "Ankunft bei Kundenadresse" | prior-art |
| delivered | `700`, `701`, `702`, `720`, `721`, `722`, `728`, `731`, `740`, `742`; "Deine Sendung wurde erfolgreich zugestellt." | fixture (`700`) |
| failed_attempt | `318`, `319`, `320`, `321`; "nicht zugestellt", "fehlgeschlagen", "storniert", "retour", "zurück" | prior-art |
| pending | not observed as an event stage; `40` is reported as `registered` | — |
| accepted | not observed; reported as unmapped | — |
| customs | not observed; reported as unmapped | — |
| ready_for_pickup | not observed; reported as unmapped | — |
| returned | not observed as a distinct stage; return wording maps to `failed_attempt` | — |

Full entries, with dates, are in `statuses.json`.

## Limitations and privacy

Event timestamps are kept exactly as the API sends them (`YYYY-MM-DD HH:mm`,
without an offset) and the declared timezone is `Europe/Berlin`, the zone of the
German service that prints them.

The endpoint needs no credential, and the consignment number alone unlocks the
order, so it is treated as part of the tracking credential: never logged, never
put in an issue, and never written into a fixture except as the carrier's own
published sample.

## Implementation decisions

- 2026-08-30: read `auftragstatusdaten` and ignore `statusdaten`. Both streams
  describe the same order, but `statusdaten` is the internal operational one:
  duplicate scans, different identifiers, and wording never shown to the
  customer. The carrier's own UI renders `auftragstatusdaten`.
- 2026-08-30: treat the all-null placeholder order as not found. The API answers
  HTTP 200 for a valid but unknown consignment number with a synthetic order, so
  accepting it would create a parcel stuck at "pending" forever.
- 2026-08-30: require the echoed Lieferschein number. Without that check a
  neighbouring order could be shown under the wrong parcel.
- 2026-08-30: the numeric `sendungsstatusId` is the authority and German wording
  is only a fallback for ids the map does not know. Map too little rather than
  wrongly.
- 2026-09-12: `HermesTrackingError` became `NotFoundError('Hermes')` — identical
  message and 404 status, so the host's unannounced-parcel path is unchanged.
  The remaining `TypeError`s became `SchemaError` with their original messages.
- 2026-09-12: the declared timezone changed from `Europe/Zurich` to
  `Europe/Berlin`. Hermes Einrichtungs-Service is a German service and the
  timestamps carry no offset, so the Swiss value was only an inherited default.
  Germany and Switzerland share the same UTC offsets year-round, so no event
  time changes — the offline suite asserts both the raw wall-clock string and
  the declared zone.

## Rejected alternatives

- Calling the appointment/address endpoints on myhes.de: they return the
  recipient's address and the drop-off permission, none of which this app keeps.
  The order lookup alone answers "where is it".
- Synthesising a location from the depot block: `depotdaten` names the handling
  depot, not where the item was scanned, so events keep an empty location rather
  than an invented one.
- Deriving the status from the newest row of both streams merged: the internal
  stream runs ahead of the customer timeline and would announce delivery before
  the customer is told.


## Verification log

- 2026-08-30: confirmed that a valid but unknown consignment number returns
  HTTP 200 with an all-null placeholder order rather than an error, and that
  `auftragstatusdaten` is the stream the carrier's own UI renders.
- 2026-09-08: live suite re-ran the carrier's published delivered sample and the
  wrong-number placeholder.
- 2026-09-12: adapter moved into this folder; the numeric status map moved to
  `status.ts` and both payloads to `fixtures/`.
- 2026-09-12: timezone corrected to `Europe/Berlin`. The two zones have shared
  offsets since 1981, so the delivered fixture's `2026-08-05 12:50` resolves
  identically before and after; this is a correctness fix to the declared zone,
  not a shift in any reported time.
