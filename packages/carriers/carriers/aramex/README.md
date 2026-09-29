# Aramex

Automatic lookups use the universal providers. The official portal returns HTTP 403 to
the production server and GitHub runners, so the direct adapter is available only for
explicit tests. See [routing](../../../../docs/ROUTING.md) for provider selection.

## Direct adapter

An anonymous overview page binds a signed detail link to the requested number. The
detail page must return that number again. The parser reads history rows without the
progress rail or recipient details. Cross-border dates have no offsets, so they remain
local wall times; incomplete rows fail the lookup.

## Limitations

Universal providers may lack domestic Aramex history. Postal Ninja is an opt-in
alternative, described in the [provider README](../../providers/postal-ninja/README.md).

## Testing

Run `npm run test:carriers:live -- packages/carriers/carriers/aramex` with
`ARAMEX_DIRECT_LIVE=1` from a network that can reach the official portal. Set
`ARAMEX_TRACKING_NUMBER` to also check an authorized real shipment.
