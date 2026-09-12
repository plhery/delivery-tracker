# Colis Privé fixtures

- `failed-attempt.json` — the parts the offline test assembles into a "Mon
  Colis" detail page: the displayed shipment number, the status banner and the
  four timeline rows of a parcel whose delivery attempt failed, plus the
  `.divDesti` recipient block and a contact line. Constructed to the page's
  shape; the shipment number is the synthetic one used by the tests and every
  recipient value is a placeholder the privacy assertion looks for.
