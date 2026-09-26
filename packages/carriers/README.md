# Carriers

Everything the app knows about carriers: the catalog, tracking-number detection, the
adapters that fetch history, the universal fallback providers and the status vocabulary.
The package imports nothing from the app, which plugs in HTTP, browser sessions and
telemetry through [`AdapterEnvironment`](core/adapter/index.ts).

- [ARCHITECTURE.md](ARCHITECTURE.md): how adapters are registered, run and reported.
- [CORPUS.md](CORPUS.md): sample tracking numbers and the detection sweep.
- [providers/](providers/README.md): Ship24, ParcelsApp, 17TRACK, Postal Ninja, UPU, plus
  [coverage by carrier](providers/COVERAGE.md).
- [docs/ROUTING.md](../../docs/ROUTING.md): how a refresh chooses between an adapter and the
  providers.

## Layout

```text
core/          detection, catalog, status vocabulary, result contract, errors, transport, runner
carriers/<id>/ one folder per carrier (below)
providers/     universal providers and the shared discovery chain
generated/     catalog, adapter registry and brand assets (never edit by hand)
scripts/       new-carrier, generate-registry, generate-readme, generate-brand, detection-golden
```

A carrier folder holds:

| File | Purpose |
| --- | --- |
| `carrier.json` | Source of truth: name, brand, timezone, links, inputs, capabilities, detection rules, `tracking.steps` |
| `numbers.json` | Sample numbers with provenance ([CORPUS.md](CORPUS.md)) |
| `statuses.json` | Observed status wording and codes, with evidence |
| `adapter.ts`, `parser.ts`, `status.ts` | Retrieval, parsing and the status map (dedicated adapters only) |
| `fixtures/`, `*.test.ts` | Scrubbed responses, offline tests, env-gated live test |
| `README.md` | Only what the files above can't say: request flow, gotchas, limitations |

`npm run contract:generate` merges every `carrier.json` into `contracts/openapi.json`
(`x-carriers`), the TypeScript and Swift contracts, the package registry and the iPhone's
offline catalog. `/api/carriers` serves the same data. Edit the folder, never the
generated output.

**Detection.** Broad numeric shapes are suggestions the user confirms. Distinctive
families and checksum-valid UPU S10 numbers pick a carrier automatically. Every rule needs
a sample number, and undeclared overlaps between carriers fail the sweep. The iPhone app
replays the same golden file.

## Adding a carrier

1. `npm run carrier:new -- --id <id> --name "<Name>" --canary-url <https url>` scaffolds
   the folder.
2. Fill `carrier.json`: detection rules (each with an `id` and a `source`), links, inputs,
   `capabilities`, `tracking.steps`.
3. Add sample numbers to `numbers.json` and run the sweep ([CORPUS.md](CORPUS.md)).
4. For a dedicated adapter: `adapter.ts` with a pure `parse()` and the factory, `status.ts`,
   scrubbed `fixtures/`, `adapter.test.ts` (capability guard and privacy assertions) and an
   env-gated `adapter.live.test.ts`.
5. Automatic carriers also need:
   - a public, credential-free `canaryUrl` that the adapter depends on;
   - a live test that sends a well-formed wrong number, which the daily canary runs;
   - a rendered-link case in `src/server/trackingLinkCases.ts`, or a reason in
     `uncheckedTrackingLinks`.
6. Adapters must use bounded timeouts and response sizes, and fall back to the carrier link
   when automatic tracking isn't reliable.
7. Keep the README short: how retrieval works, gotchas and why, limitations, how to run
   the live test. No dates, status tables or copies of `carrier.json`.
8. Run `npm run contract:generate`, `node packages/carriers/scripts/generate-readme.mjs`,
   `npm run ios:resources`, then `npm run test:contract`, lint, typecheck and the tests.
9. Add a migration extending the package carrier constraint, and verify one real parcel end
   to end.

## Tests

```sh
npx vitest run --config vitest.server.config.ts packages/carriers   # offline, fixtures only
npm run test:carriers:live      # opt-in live probes; real numbers come from env vars
npm run test:tracking-links     # rendered carrier tracking pages, synthetic numbers
npm run test:contract           # generated files are current
```

Live probes send well-formed but wrong numbers and expect each carrier's clean not-found
(or its known challenge). Real numbers are only ever read from environment variables.

The **daily canary** workflow runs the probes that need no private input
(`npm run test:carriers:canary`, with Chromium), the rendered-link checks, and a
reachability check of every `canaryUrl` (404, 410 and 5xx fail). A failing run on `main`
opens or updates one "Daily carrier canary failures" issue, and a clean run closes it.
Challenges and bot blocks count as inconclusive, not as passes.

The canary never sends or logs tracking numbers. It reports carrier ids, hosts, HTTP
statuses, timings and network error codes.

`src/server/fixtures/auditedTrackingHistory.json` replays reviewed provider descriptions
(no numbers, times or places) through stage classification on every `npm test`.

## Overview

<!-- GENERATED:carriers -->
105 carriers: 46 with a dedicated adapter, 55 through the universal providers, the rest through another carrier's adapter or link only. Roughly ordered by prominence. Generated by `node packages/carriers/scripts/generate-readme.mjs`.

| Id | Name | Route | Steps | Capabilities | Sample numbers | Known statuses | Docs |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| `dhl` | DHL | dedicated | direct → trawl | 3 | 11 | 22 | [README](carriers/dhl/README.md) |
| `ups` | UPS | dedicated | direct → trawl | 3 | 6 | 30 | [README](carriers/ups/README.md) |
| `fedex` | FedEx | dedicated | trawl | 4 | 8 | 29 | [README](carriers/fedex/README.md) |
| `usps` | USPS | dedicated | trawl | 3 | 17 | 19 | [README](carriers/usps/README.md) |
| `amazon-logistics` | Amazon Logistics | link only |  | 0 | 24 | 0 | [README](carriers/amazon-logistics/README.md) |
| `amazon-shipping` | Amazon Shipping | dedicated | direct | 4 | 5 | 14 | [README](carriers/amazon-shipping/README.md) |
| `royal-mail` | Royal Mail | universal providers |  | 3 | 4 | 11 | [README](carriers/royal-mail/README.md) |
| `swiss-post` | Swiss Post | dedicated | direct | 4 | 4 | 28 | [README](carriers/swiss-post/README.md) |
| `la-poste` | La Poste / Colissimo | dedicated | direct → retry | 4 | 9 | 22 | [README](carriers/la-poste/README.md) |
| `dpd` | DPD | dedicated | direct → page | 5 | 2 | 10 | [README](carriers/dpd/README.md) |
| `dhl-ecommerce` | DHL eCommerce | dedicated | browser | 5 | 8 | 18 | [README](carriers/dhl-ecommerce/README.md) |
| `aliexpress` | AliExpress / Cainiao | dedicated | direct | 4 | 2 | 50 | [README](carriers/aliexpress/README.md) |
| `china-post` | China Post | universal providers |  | 0 | 4 | 0 | [README](carriers/china-post/README.md) |
| `ems` | EMS | dedicated | direct | 2 | 3 | 16 | [README](carriers/ems/README.md) |
| `sf-express` | SF Express | dedicated | trawl | 2 | 3 | 47 | [README](carriers/sf-express/README.md) |
| `gls-de` | GLS Germany | dedicated | direct | 7 | 5 | 26 | [README](carriers/gls-de/README.md) |
| `gls-fr` | GLS France | dedicated | direct | 4 | 6 | 29 | [README](carriers/gls-fr/README.md) |
| `gls-ch` | GLS Switzerland | dedicated | direct | 7 | 1 | 26 | [README](carriers/gls-ch/README.md) |
| `hermes-de` | Hermes Germany | dedicated | direct | 5 | 6 | 39 | [README](carriers/hermes-de/README.md) |
| `evri` | Evri | dedicated | direct | 3 | 2 | 16 | [README](carriers/evri/README.md) |
| `chronopost` | Chronopost | via la-poste | direct → retry | 4 | 8 | 6 | [README](carriers/chronopost/README.md) |
| `mondial-relay` | Mondial Relay | dedicated | trawl | 2 | 8 | 45 | [README](carriers/mondial-relay/README.md) |
| `inpost` | InPost | dedicated | direct | 1 | 8 | 21 | [README](carriers/inpost/README.md) |
| `spring-gds` | PostNL | dedicated | direct | 4 | 16 | 16 | [README](carriers/spring-gds/README.md) |
| `canada-post` | Canada Post | dedicated | direct | 4 | 4 | 15 | [README](carriers/canada-post/README.md) |
| `australia-post` | Australia Post | dedicated | trawl | 4 | 4 | 22 | [README](carriers/australia-post/README.md) |
| `japan-post` | Japan Post | dedicated | direct | 2 | 2 | 18 | [README](carriers/japan-post/README.md) |
| `india-post` | India Post | dedicated | direct | 3 | 4 | 13 | [README](carriers/india-post/README.md) |
| `poste-italiane` | Poste Italiane | dedicated | direct | 2 | 8 | 17 | [README](carriers/poste-italiane/README.md) |
| `correos-spain` | Correos | dedicated | direct | 5 | 10 | 41 | [README](carriers/correos-spain/README.md) |
| `bpost` | bpost | universal providers |  | 0 | 4 | 0 |  |
| `austrian-post` | Austrian Post | universal providers |  | 0 | 2 | 0 |  |
| `postnord` | PostNord | universal providers |  | 0 | 1 | 0 |  |
| `tnt` | TNT | universal providers |  | 0 | 4 | 0 |  |
| `aramex` | Aramex | universal providers |  | 0 | 1 | 0 |  |
| `yunexpress` | YunExpress | universal providers |  | 0 | 1 | 0 |  |
| `four-px` | 4PX | universal providers |  | 0 | 1 | 0 |  |
| `yanwen` | Yanwen | universal providers |  | 0 | 2 | 0 |  |
| `j-and-t` | J&T Express | universal providers |  | 0 | 1 | 0 |  |
| `jd-logistics` | JD Logistics | universal providers |  | 0 | 1 | 0 |  |
| `zto` | ZTO Express | universal providers |  | 0 | 1 | 0 |  |
| `yto` | YTO Express | universal providers |  | 0 | 1 | 0 |  |
| `yunda` | Yunda Express | universal providers |  | 0 | 1 | 0 |  |
| `sto` | STO Express | universal providers |  | 0 | 1 | 0 |  |
| `yamato` | Yamato Transport | universal providers |  | 0 | 1 | 0 |  |
| `correios-br` | Correios Brazil | universal providers |  | 0 | 3 | 0 |  |
| `singapore-post` | Singapore Post | universal providers |  | 0 | 3 | 0 |  |
| `hongkong-post` | Hongkong Post | universal providers |  | 0 | 1 | 0 |  |
| `korea-post` | Korea Post | universal providers |  | 0 | 1 | 0 |  |
| `planzer` | Planzer | dedicated | direct | 2 | 4 | 26 | [README](carriers/planzer/README.md) |
| `quickpac` | Quickpac | via planzer | direct | 2 | 1 | 26 | [README](carriers/quickpac/README.md) |
| `dpd-fr` | DPD France | dedicated | direct → trawl | 3 | 3 | 40 | [README](carriers/dpd-fr/README.md) |
| `parcelforce` | Parcelforce Worldwide | universal providers |  | 0 | 1 | 0 |  |
| `purolator` | Purolator | universal providers |  | 0 | 7 | 0 |  |
| `ontrac` | OnTrac | universal providers |  | 0 | 15 | 0 |  |
| `delhivery` | Delhivery | universal providers |  | 0 | 2 | 0 |  |
| `blue-dart` | Blue Dart | universal providers |  | 0 | 3 | 0 |  |
| `dtdc` | DTDC | universal providers |  | 0 | 1 | 0 |  |
| `ninja-van` | Ninja Van | universal providers |  | 0 | 2 | 0 |  |
| `packeta` | Packeta | dedicated | direct | 4 | 4 | 16 | [README](carriers/packeta/README.md) |
| `poczta-polska` | Poczta Polska | universal providers |  | 0 | 6 | 0 |  |
| `bring-posten` | Bring | universal providers |  | 0 | 1 | 0 |  |
| `posti` | Posti | dedicated | direct → refresh | 5 | 1 | 13 | [README](carriers/posti/README.md) |
| `an-post` | An Post | universal providers |  | 0 | 1 | 0 |  |
| `ctt` | CTT Portugal | dedicated | direct | 3 | 1 | 10 | [README](carriers/ctt/README.md) |
| `ctt-express` | CTT Express | universal providers |  | 0 | 3 | 0 |  |
| `brt` | BRT | universal providers |  | 0 | 3 | 0 |  |
| `seur` | SEUR | universal providers |  | 0 | 3 | 0 |  |
| `correos-express` | Correos Express | universal providers |  | 0 | 3 | 0 |  |
| `mrw` | MRW | universal providers |  | 0 | 5 | 0 |  |
| `nacex` | NACEX | universal providers |  | 0 | 2 | 0 |  |
| `colis-prive` | Colis Privé | dedicated | direct | 1 | 3 | 34 | [README](carriers/colis-prive/README.md) |
| `relais-colis` | Relais Colis | dedicated | direct | 1 | 3 | 42 | [README](carriers/relais-colis/README.md) |
| `paack` | Paack | dedicated | direct | 2 | 5 | 44 | [README](carriers/paack/README.md) |
| `asendia` | Asendia | dedicated | direct | 4 | 10 | 109 | [README](carriers/asendia/README.md) |
| `landmark-global` | Landmark Global | universal providers |  | 0 | 3 | 0 |  |
| `nz-post` | NZ Post | universal providers |  | 0 | 2 | 0 |  |
| `pos-malaysia` | Pos Malaysia | dedicated | direct | 3 | 4 | 7 | [README](carriers/pos-malaysia/README.md) |
| `thailand-post` | Thailand Post | universal providers |  | 0 | 1 | 0 |  |
| `ukrposhta` | Ukrposhta | universal providers |  | 0 | 1 | 0 |  |
| `estafeta` | Estafeta | universal providers |  | 0 | 1 | 0 |  |
| `correos-chile` | Correos de Chile | universal providers |  | 0 | 1 | 0 |  |
| `the-courier-guy` | The Courier Guy | universal providers |  | 0 | 1 | 0 |  |
| `geodis` | GEODIS | dedicated | direct | 3 | 2 | 46 | [README](carriers/geodis/README.md) |
| `dachser` | Dachser | dedicated | direct | 2 | 1 | 13 | [README](carriers/dachser/README.md) |
| `old-dominion` | Old Dominion | universal providers |  | 0 | 6 | 0 |  |
| `swiss-post-cargo` | Swiss Post Cargo | dedicated | direct | 3 | 1 | 14 | [README](carriers/swiss-post-cargo/README.md) |
| `postlogistics` | PostLogistics | dedicated | direct | 3 | 1 | 5 | [README](carriers/postlogistics/README.md) |
| `hermes` | Hermes Einrichtungs-Service | dedicated | direct | 2 | 1 | 26 | [README](carriers/hermes/README.md) |
| `heppner` | Heppner | dedicated | direct | 2 | 1 | 8 | [README](carriers/heppner/README.md) |
| `ciblex` | Ciblex | dedicated | direct | 2 | 3 | 27 | [README](carriers/ciblex/README.md) |
| `c-chez-vous` | C Chez Vous | dedicated | direct | 1 | 2 | 5 | [README](carriers/c-chez-vous/README.md) |
| `colisweb` | Colisweb | dedicated | direct | 2 | 1 | 20 | [README](carriers/colisweb/README.md) |
| `delivengo` | Delivengo | via la-poste | direct → retry | 4 | 1 | 0 | [README](carriers/delivengo/README.md) |
| `uniuni` | UniUni | universal providers |  | 0 | 2 | 0 |  |
| `speedx` | SpeedX | universal providers |  | 0 | 4 | 0 |  |
| `gofo` | GOFO Express | universal providers |  | 0 | 2 | 0 |  |
| `ecoscooting` | Ecoscooting | universal providers |  | 0 | 5 | 0 |  |
| `tipsa` | TIPSA | universal providers |  | 0 | 1 | 0 |  |
| `canpar` | Canpar | universal providers |  | 0 | 4 | 0 |  |
| `spee-dee` | Spee-Dee | universal providers |  | 0 | 3 | 0 |  |
| `sunyou` | SunYou | dedicated | direct | 1 | 3 | 7 | [README](carriers/sunyou/README.md) |
| `shipup` | ShipUp | universal providers |  | 0 | 1 | 0 |  |
| `intl-post` | Unknown postal carrier | universal providers |  | 0 | 2 | 0 |  |
| `unknown` | Unknown carrier | universal providers |  | 0 | 15 | 0 |  |

### Universal providers
| Id | Docs |
| --- | --- |
| `parcelsapp` | [README](providers/parcelsapp/README.md) |
| `postal-ninja` | [README](providers/postal-ninja/README.md) |
| `seventeentrack` | [README](providers/seventeentrack/README.md) |
| `ship24` | [README](providers/ship24/README.md) |
| `upu` | [README](providers/upu/README.md) |
<!-- /GENERATED:carriers -->
