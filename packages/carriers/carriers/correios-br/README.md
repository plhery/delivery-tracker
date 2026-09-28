# Correios Brazil

Tracks postal S10 references through the official anonymous single-object portal.

## How it works

Each lookup creates an isolated cookie jar, loads the portal, reads its text CAPTCHA
and submits one result request. A bundled [MIT-licensed model](model/README.md)
recognizes this portal's image locally using a CPU worker reused until idle. One fresh image
retry is allowed after unreadable text or an explicit rejected CAPTCHA. Changed
image formats and exhausted attempts report a challenge for routing fallback.

## Notes

The response must echo the requested reference. Scan classification uses both the
event code and subtype; delivery-related codes also describe failures. Scans keep
the provider's newest-first order, including unresolved clocks. Valid explicit
per-row IANA zones provide instants; missing, invalid or ambiguous zones retain
local clocks. Error replies without identity, including period errors, remain
inconclusive. Calendar-day estimates, addresses, recipients, proof images and
tokens are excluded.

## Testing

Set `CORREIOS_BR_TRACKING_NUMBER` to an authorized real reference and run
`npm run test:carriers:live -- packages/carriers/carriers/correios-br`.
