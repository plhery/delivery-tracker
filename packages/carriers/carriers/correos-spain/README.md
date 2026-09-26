# Correos

The Spanish postal operator. Tracked through the keyless `localizador.correos.es`
traceability service behind the public tracker. Correos Express (`correos-express`) and
Correos de Chile (`correos-chile`) are separate carriers.

## How it works

1. `direct`: one `GET https://localizador.correos.es/canonico/eventos_envio_servicio/{code}`
   with the web channel's parameters (`codAplicacion=60&codCanal=3&codIdioma=ES&indUltEvento=N`).
   No cookies, token or account. The HTTP status is always 200; the envelope decides:
   - The body is a single-element array, or a bare object for some error bodies. The echoed
     `codEnvio` must match.
   - `error.codError` `0` is a real answer. Any other code (e.g. `3`, "Sin Trazabilidad en
     Minerva", with `eventos: null`) means unknown or not yet scanned: `NotFoundError`.
   - `codError` `0` with no events is `unknown`, with `resumen_ultimo` as the status text.
   - Non-200 is `UpstreamHttpError`.

## Notes

- Detection covers checksum-valid `…ES` S10 numbers, `PR` + 15 digits + `C`, and the
  23-character parcel codes: a product prefix (`P…` parcels such as `PQ`, `PK`, `PH`; `D…`
  returns), a 4-character label code, 16 digits and a check letter. The check-letter
  algorithm is unknown, so the rule only checks the shape. Correos Express's all-digit
  23-character numbers don't match. The adapter itself accepts any code and lets the
  envelope decide.
- Only `codEvento` is mapped, never the Spanish `desTextoResumen` prose.
- `L010000V`, `I010000V`, `X120000V` and `EOL.9001` come from a community integration and
  were never re-observed (`EOL.9001` does not even match the Correos code shape). They are
  kept because they cost nothing: any other unmapped code still reports `unknown` and the
  sync records it.
- Times come split as `fecEvento` (`DD/MM/YYYY`) and `horEvento` (`HH:MM:SS`, midnight when
  absent) and are read as `Europe/Madrid`.
- The office (`nom_codired`) becomes `pickup_point` only while the parcel awaits collection.
  On a delivered parcel it is where the parcel *was* held and would read as a false pickup
  instruction.
- Weight (`peso`, grams → kg) and dimensions (`largo`/`ancho`/`alto` → `L x W x H cm`) are
  kept: operational data users check against a merchant listing.
- `nombre_cliente` is not projected: for a private recipient it is a person's name. Address,
  phone and signature blocks are never read; a test asserts it.
- At most 20 events are returned, newest first.
- Not used: scraping `correos.es/.../detalle`. It is a JavaScript app and its HTML carries no
  history.

## Limitations

- No delivery estimate and no event locations.
- Canary Islands scans are read as Madrid time and can be one hour off: events carry no
  locality to key `Atlantic/Canary` on.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/correos-spain`. The unknown-number
check needs no env vars; set `CORREOS_SPAIN_DELIVERED_TRACKING_NUMBER` to also check a real
delivered parcel.
