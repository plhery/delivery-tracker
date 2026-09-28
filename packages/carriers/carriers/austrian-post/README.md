# Austrian Post

Tracks domestic 22-digit and Austrian S10 postal numbers through the public
tracking website's anonymous GraphQL read.

## How it works

`direct` queries the public endpoint once and requires the returned item number
to match. The optional Post account flow is unnecessary for public history.

## Notes

Summary codes and scan codes use different vocabularies. A scan marked `IZ` can
describe completed delivery; its reason and wording determine the event stage.
Timestamps carry explicit offsets, which are preserved.

## Limitations

Account-only delivery options and recipient details are not retrieved. Empty
history and GraphQL errors remain inconclusive so another source can help.

## Testing

Set `AUSTRIAN_POST_TRACKING_NUMBER` outside the repository, then run
`npm run test:carriers:live -- packages/carriers/carriers/austrian-post`.
