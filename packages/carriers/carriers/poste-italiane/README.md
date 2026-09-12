# Poste Italiane

## Identity and scope

`poste-italiane` — the Italian universal postal operator. Last mile in `IT`.
Tracked automatically; no postcode or capability URL is needed. Dutch handoffs
of Poste Italiane consignments stay with PostNL.

## Portals

- Public tracker: `https://www.poste.it/cerca/index.html#/risultati-spedizioni/{trackingNumber}`.
  The fragment deep link resolves the code and renders the tracker; expired
  parcels show the documented "Tracciatura non disponibile".
- The page is served by the keyless DoveQuando REST endpoint
  (`/online/dovequando/DQ-REST/ricercasemplice`), which is what the adapter reads.
- Canary: `https://www.poste.it/`.

## What we retrieve

| Field | Kept | Notes |
|---|---|---|
| status / stage | yes | mapped from `statoLavorazione` wording, or forced by envelope `stato` "5" |
| history | yes | newest first, at most 20 events |
| eta | yes | `dataPrevistaConsegna` reduced to a local calendar day; cleared once delivered |
| location | no | `luogo` is dropped: nothing tells a depot from a recipient address |
| sender / recipient / signature / office / weight | no | present on the envelope, never retained |

Declared capabilities: `history`, `eta`. The offline test asserts both against
the fixture.

## Tracking numbers

Three high-confidence rules: `^RA\d{11}$`, the 13-character
`1UW`/`3UW`/`5P` families, and `^2IMA\d{10}$`. Anything else stays with the
generic postal fallback. `numbers.json` holds the samples the sweep replays.

## How the adapter works

Single step, `direct`. One `POST` to the DoveQuando endpoint with
`{ codiceSpedizione, tipoRichiedente: "WEB", periodoRicerca: 1 }`; no cookies,
account, token or browser state. The response is bound to the request by the
echoed `idTracciatura`.

The envelope decides the outcome, never the HTTP status:

- `esitoRicerca` "1" or "2" — documented unknown outcomes → `NotFoundError`.
- No `esitoRicerca` with empty `listaMovimenti` — an old expired parcel. Unknown
  and expired are indistinguishable to an anonymous caller by design, and both
  are clean not-founds.
- `esitoRicerca` "3" with no movements — the parcel exists but has not been
  scanned: `pending` / `registered`, not unknown.
- Envelope `stato` "5" forces `delivered` whatever the movement wording says.

Timestamps: `dataOra` is epoch milliseconds, rendered as UTC ISO strings with
milliseconds. `core/time`'s `epochMillisTime` suppresses those milliseconds, so
a local helper is kept rather than silently rewriting persisted timestamps.

Errors: `NotFoundError('Poste Italiane')` for the unknown outcomes,
`SchemaError` for a payload that does not bind to the requested shipment,
`UpstreamHttpError` for a non-200.

## Status reference

| Stage | Wording (raw, Italian) | Confirmed by |
|---|---|---|
| registered | `la spedizione è stata presa in carico…`, `da un nostro operatore presso l’ufficio postale…`, `a seguito di acquisto da poste.it` | prior-art |
| in_transit | `la spedizione è in transito…`, `completata la fase di verifica per lo svincolo…`, `all’estero`, `presso il paese estero in data`, `in data` | prior-art |
| out_for_delivery | `la spedizione è in consegna` | prior-art |
| ready_for_pickup | `disponibile per il ritiro dal giorno lavorativo successivo alla data indicata` | prior-art |
| delivered | `la spedizione è stata consegnata`, `con successo in data` | prior-art |
| delivered | `la spedizione e' stata consegnata` (ASCII apostrophe) | live |
| delivered | envelope `stato` = `5` | live |
| failed_attempt | `consegna non andata a buon fine…`, `sono in corso delle verifiche sulla spedizione. contatta assistenza` | prior-art |
| returned | `in restituzione al mittente…` | prior-art |
| pending | — | not observed; reported as unmapped |
| accepted | — | not observed; reported as unmapped |
| customs | — | not observed; reported as unmapped (customs release maps to `in_transit`) |

The Italian vocabulary is explicitly still being observed: unmapped wording
yields no stage, the result reports `unknown` with the raw text preserved, and
the sync classifies and records it for review.

## Limitations and privacy

- No event locations at all: `luogo` is deliberately dropped.
- The estimate is a prose sentence, so it is reduced to a calendar day and never
  a timestamp; unparsable text simply yields no estimate.
- Sender, recipient, address, signature, weight, dimension, flag and
  pickup-office blocks travel on the envelope and are never retained. The
  offline test feeds a fixture carrying all of them and asserts the result JSON
  contains none of their values.

## Implementation decisions

- 2026-09-11: use the keyless DoveQuando REST endpoint that backs the public
  tracker rather than the rendered page. One POST, no session.
- 2026-09-11: let the envelope, not the HTTP status, decide the outcome. The
  endpoint answers 200 for unknown numbers; `esitoRicerca` "1"/"2" and the
  esito-less empty-movements shape are the two documented unknown answers.
- 2026-09-11: accept that unknown and expired are indistinguishable to an
  anonymous caller, and report both as a clean not-found.
- 2026-09-11: `esitoRicerca` "3" with no movements is `pending` / `registered`,
  not unknown — the parcel exists, it has simply not been scanned.
- 2026-09-11: envelope `stato` "5" wins over the movement wording, because a
  delivered parcel sometimes carries a truncated last line.
- 2026-09-11: drop `luogo`. Nothing in the payload distinguishes a depot from a
  recipient address, and guessing would leak one.
- 2026-09-11: reduce `dataPrevistaConsegna` to a calendar day. It is prose in
  Italian ("Consegna prevista entro Venerdì 2 Gennaio 2026"), so a timestamp
  would be invented precision.
- 2026-09-11: added the ASCII-apostrophe delivered variant after seeing it live;
  both apostrophes are now accepted wherever Italian uses one.
- 2026-09-12: keep the local epoch-millis time helper instead of
  `core/time`'s `epochMillisTime`. The core helper suppresses milliseconds
  (`2026-01-04T00:00:00Z`) while this adapter has always emitted them
  (`2026-01-04T00:00:00.000Z`), and those strings are persisted.
- 2026-09-12: `normalizePosteItalianeTrackingNumber` keeps throwing `TypeError`;
  it validates an argument, not a provider response.

## Rejected alternatives

- Scraping `poste.it/cerca`: a JavaScript app, so the HTML carries no history.
- Mapping the Italian wording with a regular-expression catch-all: the
  vocabulary is open, and a wrong terminal stage is worse than an `unknown` the
  sync can classify and record.
- Stamping `Europe/Rome` on the movement times: `dataOra` is already epoch
  milliseconds, so there is nothing to stamp.


## Universal provider compatibility

Probed 2026-09-12 with the corpus number `CH166307960NL` (shipment, `public_shipment_report`, [source](https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/reso-ritornato-al-mittente-e-p/5341225f84324f54e4)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt (PostNL/UPU, not Poste Italiane) |
| 17TRACK | ⏳ Not verified in this pass — requires the pinned TRAWL build (see `../../providers/seventeentrack/README.md`) |

Also tried the other 7 public numbers on Ship24: 7× 404, `2IMA0051035900` 201 without history.

## Verification log

- 2026-09-10: live check. Unknown codes answer HTTP 200 with `esitoRicerca` "1";
  old expired parcels answer without `esitoRicerca` and with empty
  `listaMovimenti`.
- 2026-09-10: the `#/risultati-spedizioni/{code}` deep link verified in a real
  browser session.
- 2026-08-24: the success vocabulary confirmed against a real parcel by the
  prior-art client.
- 2026-09-11: ASCII-apostrophe delivered wording observed live and added.
- 2026-09-12: adapter moved into this folder; the classifier moved to
  `status.ts` and the error classes moved onto the shared taxonomy.
- 2026-09-12: universal-provider probe with corpus number `CH166307960NL`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
