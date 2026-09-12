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
| `failed_attempt` | `réclamation`, `enquête est ouverte`, `échec de livraison`, `livraison impossible`, `tentative de livraison`, `incident`, `anomalie`, `endommagé`, `refusé`, `perdu`, `retard` | fixture / live |
| `delivered` | `votre colis est livré`, `votre colis a été livré`, `remis au destinataire`, `livraison effectuée` | fixture / live |
| `ready_for_pickup` | `disponible en relais`, `disponible au relais`, `disponible en agence`, `disponible en consigne`, `attend en relais` | live |
| `out_for_delivery` | `en cours de livraison`, `en tournée de livraison`, `chauffeur a pris en charge` | fixture / live |
| `registered` | `en préparation chez l'expéditeur`, `informations concernant votre colis ont été transmises`, `données du colis transmises` | live |
| `in_transit` | `remis à DPD`, `pris en charge par DPD`, `en transit`, `arrivé en France`, `arrivé dans notre agence`, `prochaine agence`, `centre de tri` | fixture / live |
| `pending` | not observed; reported as unmapped | — |
| `accepted` | not observed; reported as unmapped | — |
| `customs` | not observed; reported as unmapped | — |

`statuses.json` lists each fragment separately. Wording the map does not
recognize keeps the row in the history and leaves the result status `unknown`,
so the newest recognized row decides the parcel's status.

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

## Verification log

- 2026-09-10: Cloudflare challenges anonymous direct requests from several
  networks; the private browser service is normally required (docs/CARRIERS.md).
- 2026-09-12: moved into this folder. The parser, the wording map and the two
  tiers are unchanged; only the error classes changed (see NOTES.md).
