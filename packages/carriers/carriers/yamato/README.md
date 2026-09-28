# Yamato Transport

Tracks domestic Japanese shipments through the public Japanese tracking form.
One HTTP form submission returns the shipment summary and scan list. The detail
heading must identify the requested number; an input echo is insufficient.
After return dispatch, subsequent scans belong to the return to the sender.

## Limitations

The portal usually omits the year from scan dates and delivery estimates. Those
scan dates remain in `provider_time_text`, with no invented timestamp or freshness
watermark. Dates that include a year use Japan's timezone. The summary still
reports the carrier's current state. International TA-Q-BIN uses a separate portal.

## Live test

Set `YAMATO_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/yamato/adapter.live.test.ts`.
