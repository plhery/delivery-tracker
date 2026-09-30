# Ecoscooting

Tracks individual parcels in Spain and Portugal through Ecoscooting's official
anonymous tracking client.

## How it works

One bounded form POST uses the Cainiao gateway configuration published in the
website. No account or session bootstrap is needed. The response must identify
the requested parcel. The gateway's query error also occurs for unavailable
orders and remains inconclusive rather than proving absence.

## Notes

Per-scan epoch milliseconds establish instants. Missing epochs retain display
text without borrowing its timezone or an older delivery timestamp. Status
comes from the latest scan. Numeric references use one of two code families:
`GTMS_*`/`TD_*`, or the last-mile `LM_*`/`SL_*`/`SC_*` family that every `CN`
reference (Portuguese `CNPRT`, older Spanish `CNESP`) uses. Either may come
with or without completion flags. A delivery or a collection at a pickup point
needs its exact code and both affirmative labels, and flags, when present, must
both affirm it; anything else stays inconclusive. Arrival at a pickup point and
the pickup point's own signature ("Delivered to PUDO") read as ready for
pickup. A parcel left at a pickup point past its deadline, and its whole
journey back to the sender, read as returned. The web client names the GTMS
code for that deadline (`GTMS_PUDO_OVERDUE`); only the last-mile one
(`PUDO_OVERDUE`) has been seen in a reply. The gateway no longer answers the
published `CNESP` references.
The labelled gram weight is converted to kilograms. Once a scan places the
parcel at a pickup point, the shop's name and address become `pickup_point`.
They stay after collection so the parcel still shows where it was collected.
The pickup PIN, the shop's phone, opening hours and station id are never read.
Destination addresses, postcodes, coordinates, delivery photos, order
identifiers and routing features are excluded. References
start with the destination postcode, after any `CN` country prefix, so samples
and fixtures use zeros there.
ICP references use a separate client normalization and are not supported.
Cainiao's other `CN` families, such as `CNUSUP`, belong to other networks.

## Live test

Set `ECOSCOOTING_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/ecoscooting/adapter.live.test.ts`.
Optionally set `ECOSCOOTING_UNKNOWN_NUMBER` to check an inconclusive query error.
Set `ECOSCOOTING_PORTUGAL_NUMBER` to check the `CN` reference completion schema.
Set `ECOSCOOTING_PICKUP_NUMBER` to a parcel collected at a pickup point to check
that collection reads as delivered and names the pickup point.
