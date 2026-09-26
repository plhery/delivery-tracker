# Poste Italiane

The Italian postal operator. Tracked through the keyless DoveQuando REST endpoint behind the
`poste.it/cerca` tracker. Dutch handoffs of Poste Italiane consignments stay with
[PostNL](../spring-gds/README.md); postal shapes outside the three detection rules use the
generic postal fallback.

## How it works

1. `direct`: one `POST https://www.poste.it/online/dovequando/DQ-REST/ricercasemplice` with
   `{ codiceSpedizione, tipoRichiedente: "WEB", periodoRicerca: 1 }` and `poste.it`
   `Origin`/`Referer`. No cookies, token or account. The echoed `idTracciatura` must match.
   The envelope decides the outcome, not the HTTP status (unknown numbers answer 200):
   - `esitoRicerca` `1` or `2`: not-found.
   - No `esitoRicerca` and empty `listaMovimenti`: an old expired parcel, also not-found.
     Unknown and expired look identical to an anonymous caller.
   - `esitoRicerca` `3` with no movements: the parcel exists but is unscanned, so
     `pending`/`registered`, not unknown.
   - Non-200 is `UpstreamHttpError`.

## Notes

- Envelope `stato` `5` forces `delivered` whatever the movement wording says: a delivered
  parcel sometimes carries a truncated last line.
- Stages come from Italian `statoLavorazione` wording. Both the typographic and the ASCII
  apostrophe are accepted (`e' stata consegnata` appears live). Unmapped wording gets no
  stage rather than a regex catch-all guess; the sync records it for review.
- Customs release wording maps to `in_transit`.
- `luogo` is dropped: nothing tells a depot from a recipient address, and guessing could leak
  the address.
- `dataPrevistaConsegna` is Italian prose ("Consegna prevista entro Venerdì 2 Gennaio 2026"),
  reduced to a calendar day and cleared once delivered. Unparsable text yields no estimate.
- `dataOra` is epoch milliseconds, so there is no zone to guess. A local helper renders it
  with milliseconds (`.000Z`) because those strings are persisted and `core/time`'s
  `epochMillisTime` would drop them.
- At most 20 events are returned, newest first.
- Sender, recipient, address, signature, weight, dimensions and pickup office are never read;
  a test asserts it.
- Not used: scraping `poste.it/cerca`. It is a JavaScript app and its HTML carries no history.

## Limitations

- No event locations.
- Day-resolution estimate only.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/poste-italiane`. The unknown-number
check needs no env vars; set `POSTE_ITALIANE_DELIVERED_TRACKING_NUMBER` to also check a real
delivered parcel.
