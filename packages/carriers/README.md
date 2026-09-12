# Carrier package

Everything the app knows about parcel carriers lives here: the catalog, the
tracking-number detection engine, the scrapers ("adapters") and the universal
providers, the status vocabulary, the sample corpus and one folder of
documentation per carrier. The package imports nothing from the web
application, so it can move to its own repository later.

- [ARCHITECTURE.md](ARCHITECTURE.md): the design, the decisions and their
  alternatives.
- [CORPUS.md](CORPUS.md): the tracking-number corpus and the detection sweep.
- [providers/README.md](providers/README.md): the universal provider chain.

## Layout

```
core/         detection, catalog, status vocabulary, result contract, errors, transport, runner, telemetry
carriers/<id> one folder per carrier: carrier.json, numbers.json, statuses.json, README, adapter, tests, fixtures
providers/    Ship24, ParcelsApp, 17TRACK, Postal Ninja and the discovery chain
generated/    catalog and adapter registry, produced by the scripts below
scripts/      new-carrier, generate-registry, generate-readme, detection-golden
```

## Adding a carrier

1. `npm run carrier:new -- --id <id> --name "<Name>" --canary-url <https url>`
   scaffolds the folder with a valid `carrier.json`, empty `numbers.json` and
   `statuses.json`, and a README skeleton.
2. Fill `carrier.json`: detection rules (each with an `id` and a `source`),
   links, portal facts, inputs, `capabilities`, `tracking.steps`.
3. Add sample numbers to `numbers.json` with their evidence family and source
   (CORPUS.md), run the sweep, record what the engine answers, declare any new
   overlap in `core/detection/collisions.json`.
4. For a dedicated adapter: `adapter.ts` exporting a pure `parse()` and the
   `adapter` factory, `status.ts` with the code or wording map and its
   provenance, scrubbed `fixtures/`, `adapter.test.ts` with the capability guard
   and privacy assertions, and an env-gated `adapter.live.test.ts`.
5. Keep integration-specific decisions and verification in one README.md;
   update the [maintained sources](ARCHITECTURE.md#sources-of-truth) rather than
   copying catalog facts or general scraper instructions into it.
6. `npm run contract:generate` (merges the catalog, regenerates the registry),
   `node packages/carriers/scripts/generate-readme.mjs`, then
   `npm run test:contract`, `npm run lint`, `npm run typecheck` and the test
   suites.
7. Add the database carrier constraint migration the app needs (see
   docs/DEPLOYMENT.md) and verify one real parcel end to end before calling the
   carrier supported.

## Running the checks

```sh
npx vitest run --config vitest.server.config.ts packages/carriers   # offline tests
npm run test:carriers:live                                          # opt-in live probes
npm run test:contract                                               # generated artifacts current
```

## Carriers

<!-- GENERATED:carriers -->
104 carriers: 36 with a dedicated adapter, 64 tracked through the universal providers, the rest through another carrier's adapter or link only. Regenerate with `node packages/carriers/scripts/generate-readme.mjs`.

| Id | Name | Route | Steps | Capabilities | Sample numbers | Known statuses | Docs |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| `aliexpress` | AliExpress / Cainiao | dedicated | direct | 4 | 2 | 50 | [README](carriers/aliexpress/README.md) |
| `amazon-logistics` | Amazon Logistics | link only |  | 0 | 24 | 0 | [README](carriers/amazon-logistics/README.md) |
| `amazon-shipping` | Amazon Shipping | dedicated | direct | 4 | 3 | 14 | [README](carriers/amazon-shipping/README.md) |
| `an-post` | An Post | universal providers |  | 0 | 1 | 0 | [README](carriers/an-post/README.md) |
| `aramex` | Aramex | universal providers |  | 0 | 1 | 0 |  |
| `asendia` | Asendia | universal providers |  | 4 | 3 | 35 | [README](carriers/asendia/README.md) |
| `australia-post` | Australia Post | universal providers |  | 0 | 3 | 0 |  |
| `austrian-post` | Austrian Post | universal providers |  | 0 | 2 | 0 |  |
| `blue-dart` | Blue Dart | universal providers |  | 0 | 3 | 0 | [README](carriers/blue-dart/README.md) |
| `bpost` | bpost | universal providers |  | 0 | 4 | 0 | [README](carriers/bpost/README.md) |
| `bring-posten` | Bring | universal providers |  | 0 | 1 | 0 |  |
| `brt` | BRT | universal providers |  | 0 | 3 | 0 | [README](carriers/brt/README.md) |
| `c-chez-vous` | C Chez Vous | dedicated | direct | 1 | 2 | 5 | [README](carriers/c-chez-vous/README.md) |
| `canada-post` | Canada Post | universal providers |  | 0 | 4 | 0 |  |
| `canpar` | Canpar | universal providers |  | 0 | 4 | 0 |  |
| `china-post` | China Post | universal providers |  | 0 | 2 | 0 |  |
| `chronopost` | Chronopost | via la-poste | direct → retry | 4 | 6 | 6 | [README](carriers/chronopost/README.md) |
| `ciblex` | Ciblex | dedicated | direct | 2 | 3 | 27 | [README](carriers/ciblex/README.md) |
| `colis-prive` | Colis Privé | dedicated | direct | 1 | 3 | 34 | [README](carriers/colis-prive/README.md) |
| `colisweb` | Colisweb | dedicated | direct | 2 | 1 | 20 | [README](carriers/colisweb/README.md) |
| `correios-br` | Correios Brazil | universal providers |  | 0 | 3 | 0 |  |
| `correos-chile` | Correos de Chile | universal providers |  | 0 | 1 | 0 |  |
| `correos-express` | Correos Express | universal providers |  | 0 | 3 | 0 | [README](carriers/correos-express/README.md) |
| `correos-spain` | Correos | dedicated | direct | 5 | 2 | 33 | [README](carriers/correos-spain/README.md) |
| `ctt` | CTT Portugal | dedicated | direct | 3 | 1 | 10 | [README](carriers/ctt/README.md) |
| `ctt-express` | CTT Express | universal providers |  | 0 | 3 | 0 | [README](carriers/ctt-express/README.md) |
| `dachser` | Dachser | dedicated | direct | 2 | 1 | 13 | [README](carriers/dachser/README.md) |
| `delhivery` | Delhivery | universal providers |  | 0 | 2 | 0 | [README](carriers/delhivery/README.md) |
| `delivengo` | Delivengo | via la-poste | direct → retry | 4 | 1 | 0 | [README](carriers/delivengo/README.md) |
| `dhl` | DHL | dedicated | direct → trawl | 3 | 11 | 22 | [README](carriers/dhl/README.md) |
| `dhl-ecommerce` | DHL eCommerce | dedicated | browser | 5 | 8 | 18 | [README](carriers/dhl-ecommerce/README.md) |
| `dpd` | DPD | dedicated | direct → page | 5 | 2 | 10 | [README](carriers/dpd/README.md) |
| `dpd-fr` | DPD France | dedicated | direct → trawl | 3 | 3 | 37 | [README](carriers/dpd-fr/README.md) |
| `dtdc` | DTDC | universal providers |  | 0 | 1 | 0 |  |
| `ecoscooting` | Ecoscooting | universal providers |  | 0 | 5 | 0 | [README](carriers/ecoscooting/README.md) |
| `estafeta` | Estafeta | universal providers |  | 0 | 1 | 0 |  |
| `evri` | Evri | universal providers |  | 0 | 1 | 0 |  |
| `fedex` | FedEx | universal providers |  | 0 | 8 | 0 |  |
| `four-px` | 4PX | universal providers |  | 0 | 1 | 0 |  |
| `geodis` | GEODIS | dedicated | direct | 3 | 2 | 46 | [README](carriers/geodis/README.md) |
| `gls-ch` | GLS Switzerland | dedicated | direct | 7 | 1 | 26 | [README](carriers/gls-ch/README.md) |
| `gls-de` | GLS Germany | dedicated | direct | 7 | 3 | 26 | [README](carriers/gls-de/README.md) |
| `gls-fr` | GLS France | dedicated | direct | 4 | 6 | 29 | [README](carriers/gls-fr/README.md) |
| `gofo` | GOFO Express | universal providers |  | 0 | 2 | 0 |  |
| `heppner` | Heppner | dedicated | direct | 2 | 1 | 8 | [README](carriers/heppner/README.md) |
| `hermes` | Hermes Einrichtungs-Service | dedicated | direct | 2 | 1 | 26 | [README](carriers/hermes/README.md) |
| `hermes-de` | Hermes Germany | dedicated | direct | 5 | 4 | 39 | [README](carriers/hermes-de/README.md) |
| `hongkong-post` | Hongkong Post | universal providers |  | 0 | 1 | 0 |  |
| `india-post` | India Post | dedicated | direct | 3 | 4 | 13 | [README](carriers/india-post/README.md) |
| `inpost` | InPost | dedicated | direct | 1 | 7 | 21 | [README](carriers/inpost/README.md) |
| `intl-post` | Unknown postal carrier | universal providers |  | 0 | 2 | 0 |  |
| `j-and-t` | J&T Express | universal providers |  | 0 | 1 | 0 | [README](carriers/j-and-t/README.md) |
| `japan-post` | Japan Post | universal providers |  | 0 | 2 | 0 |  |
| `jd-logistics` | JD Logistics | universal providers |  | 0 | 1 | 0 |  |
| `korea-post` | Korea Post | universal providers |  | 0 | 1 | 0 |  |
| `la-poste` | La Poste / Colissimo | dedicated | direct → retry | 4 | 9 | 16 | [README](carriers/la-poste/README.md) |
| `landmark-global` | Landmark Global | universal providers |  | 0 | 3 | 0 |  |
| `mondial-relay` | Mondial Relay | dedicated | trawl | 2 | 8 | 40 | [README](carriers/mondial-relay/README.md) |
| `mrw` | MRW | universal providers |  | 0 | 5 | 0 | [README](carriers/mrw/README.md) |
| `nacex` | NACEX | universal providers |  | 0 | 2 | 0 | [README](carriers/nacex/README.md) |
| `ninja-van` | Ninja Van | universal providers |  | 0 | 2 | 0 |  |
| `nz-post` | NZ Post | universal providers |  | 0 | 2 | 0 |  |
| `old-dominion` | Old Dominion | universal providers |  | 0 | 6 | 0 |  |
| `ontrac` | OnTrac | universal providers |  | 0 | 15 | 0 |  |
| `paack` | Paack | dedicated | direct | 2 | 5 | 44 | [README](carriers/paack/README.md) |
| `packeta` | Packeta | dedicated | direct | 4 | 4 | 16 | [README](carriers/packeta/README.md) |
| `parcelforce` | Parcelforce Worldwide | universal providers |  | 0 | 1 | 0 |  |
| `planzer` | Planzer | dedicated | direct | 2 | 4 | 26 | [README](carriers/planzer/README.md) |
| `poczta-polska` | Poczta Polska | universal providers |  | 0 | 6 | 0 |  |
| `pos-malaysia` | Pos Malaysia | dedicated | direct | 3 | 4 | 7 | [README](carriers/pos-malaysia/README.md) |
| `poste-italiane` | Poste Italiane | dedicated | direct | 2 | 8 | 17 | [README](carriers/poste-italiane/README.md) |
| `posti` | Posti | universal providers |  | 0 | 1 | 0 |  |
| `postlogistics` | PostLogistics | dedicated | direct | 3 | 1 | 5 | [README](carriers/postlogistics/README.md) |
| `postnord` | PostNord | universal providers |  | 0 | 1 | 0 |  |
| `purolator` | Purolator | universal providers |  | 0 | 7 | 0 |  |
| `quickpac` | Quickpac | via planzer | direct | 2 | 1 | 26 | [README](carriers/quickpac/README.md) |
| `relais-colis` | Relais Colis | dedicated | direct | 1 | 3 | 42 | [README](carriers/relais-colis/README.md) |
| `royal-mail` | Royal Mail | universal providers |  | 0 | 2 | 0 |  |
| `seur` | SEUR | universal providers |  | 0 | 3 | 0 | [README](carriers/seur/README.md) |
| `sf-express` | SF Express | universal providers |  | 0 | 2 | 0 |  |
| `shipup` | ShipUp | universal providers |  | 0 | 1 | 0 |  |
| `singapore-post` | Singapore Post | universal providers |  | 0 | 3 | 0 |  |
| `spee-dee` | Spee-Dee | universal providers |  | 0 | 3 | 0 |  |
| `speedx` | SpeedX | universal providers |  | 0 | 4 | 0 | [README](carriers/speedx/README.md) |
| `spring-gds` | PostNL | dedicated | direct | 4 | 16 | 16 | [README](carriers/spring-gds/README.md) |
| `sto` | STO Express | universal providers |  | 0 | 1 | 0 |  |
| `sunyou` | SunYou | dedicated | direct | 1 | 3 | 7 | [README](carriers/sunyou/README.md) |
| `swiss-post` | Swiss Post | dedicated | direct | 4 | 4 | 28 | [README](carriers/swiss-post/README.md) |
| `swiss-post-cargo` | Swiss Post Cargo | dedicated | direct | 3 | 1 | 14 | [README](carriers/swiss-post-cargo/README.md) |
| `thailand-post` | Thailand Post | universal providers |  | 0 | 1 | 0 |  |
| `the-courier-guy` | The Courier Guy | universal providers |  | 0 | 1 | 0 |  |
| `tipsa` | TIPSA | universal providers |  | 0 | 1 | 0 | [README](carriers/tipsa/README.md) |
| `tnt` | TNT | universal providers |  | 0 | 4 | 0 |  |
| `ukrposhta` | Ukrposhta | universal providers |  | 0 | 1 | 0 |  |
| `uniuni` | UniUni | universal providers |  | 0 | 2 | 0 | [README](carriers/uniuni/README.md) |
| `unknown` | Unknown carrier | universal providers |  | 0 | 15 | 0 |  |
| `ups` | UPS | dedicated | direct → trawl | 3 | 6 | 26 | [README](carriers/ups/README.md) |
| `usps` | USPS | universal providers |  | 0 | 14 | 0 |  |
| `yamato` | Yamato Transport | universal providers |  | 0 | 1 | 0 |  |
| `yanwen` | Yanwen | universal providers |  | 0 | 2 | 0 |  |
| `yto` | YTO Express | universal providers |  | 0 | 1 | 0 |  |
| `yunda` | Yunda Express | universal providers |  | 0 | 1 | 0 |  |
| `yunexpress` | YunExpress | universal providers |  | 0 | 1 | 0 | [README](carriers/yunexpress/README.md) |
| `zto` | ZTO Express | universal providers |  | 0 | 1 | 0 |  |

### Universal providers
| Id | Docs |
| --- | --- |
| `parcelsapp` | [README](providers/parcelsapp/README.md) |
| `postal-ninja` | [README](providers/postal-ninja/README.md) |
| `seventeentrack` | [README](providers/seventeentrack/README.md) |
| `ship24` | [README](providers/ship24/README.md) |
<!-- /GENERATED:carriers -->
