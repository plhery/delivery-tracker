# Relais Colis fixtures

- `returned-timeline.json` — the `.follow-step` sentences the offline test
  renders into the recipient page, covering the returned, pickup-ready,
  in-transit, collected and announced steps of one parcel. Constructed:
  provider-shaped French wording paired with the made-up `CC200000000401`
  number from `numbers.json`. The page the test builds around it also carries
  `PRIVATE RECIPIENT` / `PRIVATE STREET` placeholders in the address block, so
  the test can assert the adapter removes that block before reading any text.
