# OnTrac

Tracks OnTrac and LaserShip parcels through the JSON endpoint used by the official website.

## How it works

One anonymous GET returns packages and scans. Exactly one returned tracking identifier must
match the request. A generic missing-resource problem response cannot distinguish an
unknown parcel from an unavailable endpoint, so it remains inconclusive. An empty or
mismatched package list is inconclusive or a schema failure.

## Notes

The endpoint's newest-first order is preserved, including scans without offsets. Valid
offset-less clocks remain local wall times; invalid dates retain their text on an undated event. Incomplete
scan rows fail the lookup so older progress cannot appear current. Each
scan uses its own regional status code; unfamiliar codes keep their wording for review.
The parser reads short scan descriptions and city/state, excluding recipient details,
references, signatures and proof-of-delivery images.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/ontrac`. Set
`ONTRAC_TRACKING_NUMBER` to check history for an authorized real parcel.
