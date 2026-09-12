# Delivengo notes

## Decisions

- **No adapter of its own.** `tracking.adapter: "la-poste"`. Delivengo numbers
  are answered by the same La Poste unified feed. The mechanics live in
  [`../la-poste/NOTES.md`](../la-poste/NOTES.md).
- **No detection rules.** Delivengo's number ranges overlap other La Poste
  services, so adding a rule would either steal numbers from Colissimo or
  produce another ambiguous suggestion. The carrier stays selectable in the
  manual picker and `numbers.json` records that the engine resolves its sample
  to La Poste / Colissimo.
- **`region.countries` is empty on purpose.** Delivengo is an export service
  from France: the last mile belongs to the destination post, and the field
  records last-mile coverage.
- **`statuses.json` records a gap instead of copying the La Poste entries.**
  Nothing has been observed on a Delivengo shipment, and inventing entries would
  claim evidence this folder does not have.

## Rejected alternatives

- **Adding a Delivengo detection rule anyway.** It would collide with La Poste
  and Chronopost without giving the user a better answer than the manual picker.
- **Linking to `mydelivengo.laposte.fr`.** That portal is the sender's account
  area and its FAQ, not a recipient tracker; the La Poste page is where a
  recipient can follow the parcel.
- **Copying the La Poste status table into this README.** It would read as
  Delivengo evidence. The table says "not observed" and points at the shared
  map instead.

## Verification log

- 2026-09-08: the one published sample (`LD…FR`, a May 2023 philately-forum
  example) returned an access error from the local public endpoint rather than
  usable history. Adapter routing and parsing are covered by the La Poste tests
  (docs/CARRIERS.md).
- 2026-09-12: folder documented; `tracking.steps`, `capabilities`, `aliases` and
  the portal fields were filled in to match the shared adapter.
