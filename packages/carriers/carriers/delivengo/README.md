# Delivengo

La Poste's export service for small international parcels. No adapter of its
own: La Poste's unified feed answers Delivengo numbers, so tracking runs through
[`la-poste`](../la-poste/README.md).

- No detection rules: its `…FR` S10 ranges overlap other La Poste services, so
  users pick Delivengo manually.
- `region.countries` is empty on purpose: the destination post does the last
  mile, and history can go quiet after export.
- The app links to La Poste's tracker; `mydelivengo.laposte.fr` is the sender's
  account area.
- No Delivengo response has been parsed end to end (the one public sample tried
  returned an access error); statuses rely on the shared La Poste map.
