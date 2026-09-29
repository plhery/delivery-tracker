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
comes from the latest scan. A numeric `GTMS_SIGNED` delivery requires its
completion flags. `CN` references (Portuguese `CNPRT`, older Spanish `CNESP`)
and newer numeric replies carry no flags. There `LM_SIGN_SUCCESS` (`CN` only)
and a collection at a pickup point (`GTMS_PUDO_SIGNED`) require their exact
code and both affirmative labels, and a flagless `GTMS_SIGNED` stays
inconclusive. Conflicting flags remain inconclusive. Arrival at a pickup point
and the pickup point's own signature (`GTMS_STA_SIGNED`, "Delivered to PUDO")
read as ready for pickup. The gateway no longer answers the published `CNESP`
references.
The labelled gram weight is converted to kilograms. Destination addresses,
postcodes, coordinates, delivery photos, order identifiers, routing features
and pickup-point details, including the pickup PIN, are excluded. References
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
that collection reads as delivered.
