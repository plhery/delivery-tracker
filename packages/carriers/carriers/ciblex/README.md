# Ciblex

French express network for time-critical and pharmaceutical deliveries. Tracked through the
public extranet parcel page, keyed by the 14-digit label number.

## How it works

1. `direct`: one bounded `GET corps.php?module=colis&colis={number}` on
   `secure.extranet.ciblex.fr`, parsed with Cheerio.
   - `.t_bandeau_detail td` must echo `SUIVI COLIS : <14 digits>` matching the request;
     a different number is a `SchemaError`. Nothing else is read before this check, so a page
     answering for another parcel can never become this parcel's history.
   - Each 4-cell row of `table[border="2"]` is a scan (header row skipped). Rows are
     de-duplicated on time, stage and place, sorted newest first and capped at 100.
   - Not-found: HTTP 404, an echoed banner with an empty table (the portal's normal
     wrong-number answer), or `.f_erreur` with no banner.
   - An empty HTTP 200 is `IndeterminateError`: it has appeared transiently and proves nothing.
     Treating it as not-found would mark live parcels unknown during an outage and trigger the
     router's back-off.

## Notes

- The 14-digit shape is shared with other European carriers, so detection is low-confidence
  and the user confirms. The 24-digit full label barcodes are not claimed.
- Status is phrase-based: the page prints French action labels and no codes. Labels are
  compared without case or diacritics (the portal alternates "Colis Livré" / "COLIS LIVRE").
  Return and delivery phrases are tested before the broader transit ones.
- Descriptions are our own English wording, not the provider's label. Unmapped wording gets a
  neutral description and is left to the sync's classifier; the current status falls back to
  the latest mapped row.
- Dates are naive `dd/MM/yyyy [HH:mm[:ss]]` wall-clock values, read in Europe/Paris via
  `zonedTime`.
- The place cell is free text and carries the recipient's address on failure rows. A place is
  kept only when it matches the depot shape `CITY 68 (68)` (same department inside the
  parentheses), and never on an exception row. The customer and order block is never read.

## Limitations

- No delivery estimate on the page.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/ciblex` (no env vars). It accepts
either the empty-table not-found or the empty-200 indeterminate answer for a synthetic number.
