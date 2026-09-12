# DPD France

## Identity and scope

DPD France, the French member of the DPDgroup network, formerly Exapaq. This
folder covers French last-mile parcels only (`region.countries: ["FR"]`); DPD
Switzerland has its own folder (`dpd`) and a completely different protocol.

## Portals

- Recipient trace page: `https://trace.dpd.fr/fr/trace/{trackingNumber}` — the
  page a recipient opens, and the link the app shows.
- One page can describe two parcels: the outbound leg (`#infos1`,
  `tr.tabTraceColisAller`) and its return leg (`#infos2`,
  `tr.tabTraceColisRetour`).
- The page shows status, the scan timeline with its agency or sorting-centre
  location, the planned delivery date, and — depending on the shipment — the
  internal customer reference, the delivery address and a proof-of-delivery
  block. Only the first four are retained.

## What we retrieve

Declared capabilities: `history`, `location`, `eta`.

Status, the timeline with each row's wording, Paris timestamp and operational
location, and the planned delivery date while the parcel is still moving. The
result also carries the public tracking URL and records that it came from a
rendered page.

## Tracking numbers

12 to 15 digits, starting with `0`, `1` or `250`. Only the 15-digit `250…`
family is distinctive enough for high-confidence detection; the broader numeric
family stays a low-confidence suggestion that the user confirms.
`numbers.json` holds two published merchant integration examples and one
synthetic number built to the published shape.

No second input is required: the trace page is keyless.

## How the adapter works

Two tiers, declared as `tracking.steps: ["direct", "trawl"]`.

1. `direct` — one bounded HTML GET of the trace page with a browser-like
   `User-Agent`, bounded to 20 s by default.
2. `trawl` — the private browser service's native `scrape` API
   (`skipHttp`, `maxTier: 3`), used only when the direct request is challenged
   by Cloudflare. It is a disabled step when `FLARESOLVERR_URL` is not
   configured; in that case the direct challenge carries the setup hint itself.

Both tiers produce HTML, and the same pure parser reads it: the requested
number selects the outbound or the return leg, rows from the other leg are
never read, and rows are de-duplicated and sorted newest first.

## Status reference

The page carries no status codes: every row is French prose, matched on a
diacritic- and punctuation-free form of the sentence. Returns and incidents are
checked before the delivery wording, because "votre colis sera retourné à
l'expéditeur" contains neither an incident noun nor a negative verb.

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| `returned` | `retour à l'expéditeur`, `retourné à l'expéditeur`, `sera retourné à l'expéditeur` | live |
| `failed_attempt` | `échec de livraison`, `livraison impossible`, `tentative de livraison`, `retard` | fixture / live |
| `exception` | `réclamation`, `enquête est ouverte`, `incident`, `anomalie`, `endommagé`, `refusé`, `perdu` | fixture / live |
| `delivered` | `votre colis est livré`, `votre colis a été livré`, `remis au destinataire`, `livraison effectuée` | fixture / live |
| `ready_for_pickup` | `disponible en relais`, `disponible au relais`, `disponible en agence`, `disponible en consigne`, `attend en relais` | live |
| `out_for_delivery` | `en cours de livraison`, `en tournée de livraison`, `chauffeur a pris en charge` | fixture / live |
| `registered` | `en préparation chez l'expéditeur`, `informations concernant votre colis ont été transmises`, `données du colis transmises` | live |
| `in_transit` | `remis à DPD`, `pris en charge par DPD`, `en transit`, `arrivé en France`, `arrivé dans notre agence`, `prochaine agence`, `centre de tri` | fixture / live |
| `pending` | not observed; reported as unmapped | — |
| `accepted` | not observed; reported as unmapped | — |
| `customs` | not observed; reported as unmapped | — |

`statuses.json` lists each fragment separately. Wording the map does not
recognize keeps the row in the history with no `stage` at all, and leaves the
result status `unknown`, so the newest recognized row decides the parcel's
status.

## Limitations and privacy

- The internal customer reference, the delivery address block and the
  proof-of-delivery block are on the page and are never read: the parser only
  visits the timeline rows and the details rows it recognizes by label.
- The return leg's rows are excluded from an outbound lookup and vice versa, so
  a shared page cannot leak the other party's history.
- The planned delivery date is dropped once the parcel is delivered or in an
  exception state.
- DPD France's site terms broadly restrict unapproved automated access, so this
  integration is experimental and should be replaced by a contracted API before
  being relied on as a long-term production integration.

## Implementation decisions

- **The direct request is kept even though Cloudflare usually blocks it.**
  It succeeds often enough — and costs one bounded GET — that going straight to
  the browser service would spend a browser on every sync. Mondial Relay made
  the opposite call because its direct path was blocked from every network
  tested; DPD France's is not.
- **The requested number selects the leg.** A trace page can carry an outbound
  parcel and its return. Reading `#infos1`/`tabTraceColisAller` for the outbound
  number and `#infos2`/`tabTraceColisRetour` for the return keeps one recipient
  from seeing the other leg's history, and makes a page for a different shipment
  a hard `SchemaError` rather than a silent mismatch.
- **Wording is matched on a normalized form.** DPD France varies accents,
  apostrophes and trailing punctuation between rows, so every comparison runs on
  the lowercase, diacritic-free, punctuation-free text.
- **Order of the wording rules is load-bearing.** Returns, then incidents, then
  delivery: "votre colis sera retourné à l'expéditeur" would otherwise fall
  through to a delivery rule, and "nous avons reçu une réclamation" would
  otherwise look like ordinary movement.
- **The missing browser tier is a disabled step, not a failed one.** When
  `FLARESOLVERR_URL` is unset the `trawl` step is skipped and the challenge
  thrown by `direct` carries the message
  "DPD France requires a browser challenge solver; configure FLARESOLVERR_URL",
  so telemetry shows one attempted step and the operator still gets the hint.
- **Assigning `in_transit` to unrecognized wording.** Resolved 2026-09-12:
  the adapter now omits `stage` entirely for wording `status.ts` does not
  recognize, like every other adapter, and the host sync's classifier records
  the wording instead. The result status for an unmapped latest row stays
  `unknown`, so the newest recognized row still decides the parcel's status.
  `status.ts` keeps its fallback tuple (owned elsewhere); the adapter is the
  caller that drops the stage.
- **Timestamps use `core/time`'s `zonedTime`.** Rows print naive
  `dd/MM/yyyy HH:mm` wall clock; Europe/Paris is applied explicitly rather than
  guessing UTC.

## Rejected alternatives

- **Looking for a JSON feed behind the page.** The trace page is server-rendered
  and exposes no reusable JSON endpoint; the timeline only exists as markup.
- **Keeping the proof-of-delivery and address blocks "for diagnostics".**
  The parser does not read those nodes or include them in the tracking result.


## Verification log

- 2026-09-10: Cloudflare challenges anonymous direct requests from several
  networks; the private browser service is normally required (docs/CARRIERS.md).
- 2026-09-12: moved into this folder. The parser, the wording map and the two
  tiers are unchanged; only the error classes changed.
- 2026-09-12: unmapped wording no longer carries an `in_transit` stage; the
  offline suite asserts the missing key and the `unknown` result status.
