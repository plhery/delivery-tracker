# Chronopost

La Poste's express arm, including Chrono Shop2Shop. No adapter of its own: La
Poste's unified feed answers Chronopost numbers, so tracking runs through
[`la-poste`](../la-poste/README.md).

- Events arrive with an empty `group`, so the event `code` is the only status
  key.
- The `PZ`, `XU`, `XW` and `XY` S10 prefixes select Chronopost; the La Poste S10
  rule excludes them.
- The app links to the Chronopost portal because that is the brand on the label.
- Not used: Chronopost's SOAP service (more consignment metadata than tracking
  needs, not meant for automated use) or scraping `chronopost.fr` (a second
  portal for no extra field).
