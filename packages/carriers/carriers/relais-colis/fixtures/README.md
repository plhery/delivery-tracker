# Relais Colis fixtures

- `returned-timeline.json`: the `.follow-step` sentences the offline test renders into the recipient page (returned, pickup-ready, in-transit, collected, announced), with the synthetic number from `numbers.json`. The test page adds `PRIVATE RECIPIENT` / `PRIVATE STREET` placeholders to check the address block is removed.
- `grouped-history.html`: the shape of a reply with history: the parcel banner without a search form, the latest-scan summary, and stages holding several dated scans. It carries the synthetic number and a `SYNTHETIC RECIPIENT` placeholder.
- `no-history.html`: the shape of a reply without history: the search form re-rendered with the searched synthetic number beside the explicit no-history message.
