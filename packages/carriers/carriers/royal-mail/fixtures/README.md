# Royal Mail fixtures

The identifiers, places, dates and recipient placeholder are synthetic.
The structure follows Royal Mail's public application bundle inspected on
2026-09-20: `mailPieces` is an object containing `mailPieceId`, `summary`,
`estimatedDelivery` and optional `events`.

- `delivered.json`: a delivered summary and four scans; recipient prose is dropped.
- `in-transit.json`: an in-transit summary, estimate and two scans.

These are parser fixtures reconstructed from the frontend, not recorded live
success replies. Live verification is separate and uses external inputs.
