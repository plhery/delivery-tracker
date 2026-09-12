# Correos

## Identity and scope

`correos-spain` — Sociedad Estatal Correos y Telégrafos, the Spanish universal
postal operator. Last mile in `ES`. Tracked automatically; no postcode or
capability URL is needed. Correos Express (`correos-express`) and Correos de
Chile (`correos-chile`) are separate carriers.

## Portals

- Public tracker: `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number={trackingNumber}`.
- The adapter reads the keyless traceability service behind it,
  `https://localizador.correos.es/canonico/eventos_envio_servicio/{code}`.
- Canary: `https://www.correos.es/`.

## What we retrieve

| Field | Kept | Notes |
|---|---|---|
| status / stage | yes | from `codEvento`, never the Spanish prose |
| history | yes | newest first, at most 20 events |
| weight | yes | envelope `peso`, grams converted to kilograms |
| dimensions | yes | `largo`/`ancho`/`alto` rendered as `L x W x H cm` |
| pickup_point | yes | envelope `nom_codired`, only while the parcel awaits collection |
| delivered_at | yes | the delivered event's timestamp |
| location | no | events carry none |
| eta | no | the localizador exposes none |

Declared capabilities: `history`, `pickup_point`, `weight`, `dimensions`,
`delivered_at`. The offline test asserts each of them against the fixture.

## Tracking numbers

One high-confidence rule: `^PR\d{15}C$`. Quarantined `CV` S10 shapes stay out.
The adapter itself accepts any Correos-issued code (S10 ES, `PQ` domestic,
`PR`-prefixed) because the envelope, not the shape, decides whether the number
is known.

## How the adapter works

Single step, `direct`. One `GET` with the web channel's query parameters
(`codAplicacion=60&codCanal=3&codIdioma=ES&indUltEvento=N`); no cookies,
account or browser state. The response is a single-element array; a bare object
is accepted too, because some error bodies come back unwrapped. Identity binds
through the echoed `codEnvio`.

The envelope decides the outcome, never the HTTP status — the transport status
is always 200:

- `error.codError` `"0"` — a real answer.
- any other `codError` (for example `"3"`, *Sin Trazabilidad en Minerva*, with
  `eventos: null`) — unknown or not yet scanned → `NotFoundError('Correos')`.
- `codError` `"0"` with no events — `unknown`, carrying the envelope's
  `resumen_ultimo` as the status text.

Timestamps: Correos splits them into `fecEvento` (`DD/MM/YYYY`) and `horEvento`
(`HH:MM:SS`, midnight when absent) in Spanish local time, read as
`Europe/Madrid`.

Errors: `NotFoundError('Correos')`, `SchemaError` for a payload that does not
bind to the requested shipment or has no result envelope, `UpstreamHttpError`
for a non-200.

## Status reference

| Stage | Code (raw) | Wording seen | Confirmed by |
|---|---|---|---|
| registered | `A010000V`, `A090000V`, `X010000V` | Admitido | prior-art |
| in_transit | `P040000V`, `P090000V`, `P100000V`, `P101110V`, `P101120V`, `P110000V`, `G01L010V`, `H01I360V`, `X020000V`, `X040000V`, `X060000V`, `X070000V`, `X110100V` | Clasificado | prior-art |
| out_for_delivery | `H020000V`, `X080000V` | En reparto | prior-art |
| ready_for_pickup | `H01I350V`, `X380000V`, `X390000V`, `L010000V` | En oficina | prior-art |
| delivered | `I01H210V`, `I010000V`, `X120000V` | Entregado | prior-art |
| failed_attempt | `H010930R`, `H06P010V`, `X090100R`, `X090060R`, `X130000R`, `M01E020R`, `EOL.9001` | — | prior-art |
| returned | `O140000V` | — | prior-art |
| pending | — | not observed; reported as unmapped | — |
| accepted | — | not observed; reported as unmapped | — |
| customs | — | not observed; reported as unmapped | — |

`L010000V`, `I010000V`, `X120000V` and `EOL.9001` are community-integration
reconstructions that have not been re-observed; `EOL.9001` does not even match
the Correos code shape. They are kept, but an unmapped code elsewhere still
reports `unknown` rather than guessing: the event keeps no stage and the sync
classifies and records the raw wording.

## Limitations and privacy

- No delivery estimate and no event locations: the localizador has neither.
- Mainland Spain is `Europe/Madrid`. Canary Islands scans are stamped the same
  way and can therefore be off by one hour; events carry no locality, so this is
  documented rather than solved.
- The office name is exposed only while the parcel is awaiting collection; when
  the parcel has been delivered it is dropped.
- The customer address, phone and signature blocks are never retained; the
  offline test feeds a fixture carrying them and asserts the result JSON
  contains none of their values.
- The envelope's `nombre_cliente` (the contract customer, which is a person's
  name for a private recipient) is not projected; nothing in the app displays it.

## Implementation decisions

- 2026-09-11: use the keyless `localizador.correos.es` traceability service that
  backs the public tracker. One GET, no session.
- 2026-09-11: let the `codError` envelope decide the outcome, not the HTTP
  status. The service answers 200 for unknown numbers.
- 2026-09-11: accept any Correos-issued code shape in the adapter (S10 ES, `PQ`,
  `PR`) and let the envelope decide. Detection stays narrow (`PR` + 15 digits +
  `C`), so only the shapes we can attribute reach this adapter automatically.
- 2026-09-11: tolerate a bare object as well as the single-element array, since
  some error bodies come back unwrapped.
- 2026-09-11: map `codEvento`, never `desTextoResumen` — the code is stable, the
  Spanish text is display prose.
- 2026-09-11: expose the office (`nom_codired`) as `pickup_point` only when the
  parcel is actually awaiting collection. On a delivered parcel the same field
  is where it *was* held, which would read as a false pickup instruction.
- 2026-09-11: keep weight and dimensions. They are operational parcel data, not
  personal data, and they are what users check against a merchant's listing.
- 2026-09-12: `normalizeCorreosSpainTrackingNumber` keeps throwing `TypeError`;
  it validates an argument, not a provider response.

## Rejected alternatives

- Scraping `correos.es/.../detalle`: a JavaScript app, so the HTML carries no
  history.
- Deriving unknown from the HTTP status: it is always 200.
- Stamping `Atlantic/Canary` on Canary Islands scans: events carry no locality,
  so there is nothing to key the decision on. The one-hour caveat is documented
  instead.
- Dropping the community-reconstructed codes (`L010000V`, `I010000V`,
  `X120000V`, `EOL.9001`): they cost nothing and an unmapped code is still
  reported as `unknown`, so a wrong reconstruction shows up as a mismatch rather
  than as silence.

## Verification log

- 2026-09-10: live check. Unknown codes answer HTTP 200 with
  `[0].error.codError` `"3"` (*Sin Trazabilidad en Minerva*) and `eventos: null`.
  The transport status is always 200.
- 2026-08-24: the success shape confirmed against a real ES parcel by the
  prior-art client (admitted → classified → out for delivery → failed attempt →
  office hold → collected).
- 2026-09-11: sender, pickup, weight and dimension retention added.
- 2026-09-12: adapter moved into this folder; the status map moved to
  `status.ts` and the error classes moved onto the shared taxonomy.
