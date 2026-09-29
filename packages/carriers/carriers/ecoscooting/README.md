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
comes from the latest scan. Spanish delivery requires its completion flags;
the Portuguese schema instead requires its success code and both affirmative
delivery labels. Conflicting flags remain inconclusive.
The labelled gram weight is converted to kilograms. Destination addresses,
postcodes, coordinates, order identifiers and routing features are excluded.
ICP references use a separate client normalization and are not supported.

## Live test

Set `ECOSCOOTING_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/ecoscooting/adapter.live.test.ts`.
Optionally set `ECOSCOOTING_UNKNOWN_NUMBER` to check an inconclusive query error.
Set `ECOSCOOTING_PORTUGAL_NUMBER` to check the Portuguese completion schema.
