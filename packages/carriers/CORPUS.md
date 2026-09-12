# The tracking-number corpus

Every carrier folder carries a `numbers.json`: the sample numbers we know for
that carrier, where each one came from, and the answer the detection engine
gives for it today. The detection sweep replays the whole set on every test run,
so a change in detection shows up as a diff in these files rather than as a
surprise in production.

```
packages/carriers/
  carriers/<id>/numbers.json          the samples for one carrier
  core/testing/numbers.schema.json    the schema every file is validated against
  core/testing/corpus.ts              loader, types and the positive/negative helpers
  core/testing/detectionSweep.test.ts the sweep itself
  core/testing/golden.ts              builds the file the native tests replay
  core/detection/collisions.json      every declared overlap between carriers
  core/detection/coverage-baseline.json  how many rules may still lack a sample
  scripts/detection-golden.mjs        regenerates contracts/fixtures/detection-golden.json
```

## Evidence families

Every record says where its number came from. The family decides what the record
may be used for and whether a source URL is required.

| `evidence` | What it means | `source` |
|---|---|---|
| `public_shipment_report` | A real number someone published on a public page (a complaint board, a forum thread). The attribution is theirs, not ours: we did not re-run the lookup. | required |
| `official_documentation_example` | An example printed in the carrier's own documentation, API reference or tracking form. Not a real shipment. | required |
| `open_source_example` | A fixture or demo value from a public open-source project. Not a real shipment, even when it has a valid checksum. | required |
| `merchant_published_example` | An illustration from a marketplace or integration guide. Not a real shipment. | required |
| `synthetic` | We made it up. `derivedFrom` says how: `official_shape` (built to fit a published format), `invented` (a placeholder), `donated_real` (the scrubbed sibling of a number somebody gave us), `observed_request` (shaped after a request we saw). | forbidden |

`role` says what the string is: a `shipment` number, a `full_barcode` printed on
the label, an `order_reference`, a `composite` of agency and shipment numbers, a
`negative` that must never resolve to a carrier, or a `quarantined` record whose
role or attribution is not settled. `quarantine: true` marks records that must
never act as a positive oracle; they still record what the engine answers today,
so drift stays visible.

## Scrubbing

**No real recipient data, ever, and no numbers taken from private messages.** A
number that is already published on the page we cite may be committed as is.

Anything else gets scrubbed: replace the identifier with a made-up value that
still satisfies the format *and* its checksum, so the record keeps testing what
it was meant to test. `RA123456785CH` is a scrubbed S10 number — the shape is
real, the check digit is valid, the shipment never existed. Record it as
`synthetic`, set `derivedFrom` to `donated_real` or `official_shape`, and put
the date you last checked the format in `shapeConfirmed`.

If a real number has to stay reachable — a live test against the carrier, say —
keep it out of git. `packages/carriers/carriers/*/private.numbers.json` is
git-ignored; put the real value there, next to the scrubbed sibling that is
committed. Those numbers expire anyway, so nothing in the repository should
depend on them.

`note` is written in our own words: one short, factual sentence. When the source
attributes a number to a carrier the engine does not select, the note says so —
the expectation still records what the engine actually answers.

## Adding a record

1. Add the number to `packages/carriers/carriers/<id>/numbers.json`, exactly as
   a user would type it. Keep punctuation that carries meaning (NACEX prints
   `1234/12345678`); the engine strips spaces, dots and dashes itself.
2. Fill in `role`, `evidence` and either `source` (published families) or
   `derivedFrom` (synthetic).
3. Run the sweep. It fails and prints the answer the engine gave; copy that into
   `expect`. Do not adjust detection to fit the number you just added — the
   corpus characterizes the engine, it does not specify it.
4. If the number makes two or more carriers match, the sweep names the
   undeclared set. Add it to `core/detection/collisions.json` with a shape and a
   one-line reason.
5. Regenerate the golden file and commit it with the record.

Records stay sorted by `role`, then by `number`, with two-space indent and a
trailing newline. A carrier with no sample yet keeps `"records": []` and a
top-level `"gap"` saying why.

## Running the sweep

```sh
npx vitest run --config vitest.server.config.ts packages/carriers/core/testing/detectionSweep
node packages/carriers/scripts/detection-golden.mjs   # rewrites contracts/fixtures/detection-golden.json
```

The sweep asserts five things:

- **Expectations.** Every record detects exactly as recorded, per carrier folder.
- **Uniqueness.** For a record the engine resolves to one carrier, no other
  carrier's rules claim high confidence.
- **Rule coverage.** Every detection rule in every `carriers/<id>/carrier.json`
  is matched by at least one record. Uncovered rules are printed and counted
  against `core/detection/coverage-baseline.json`; the honest fix is a sample,
  not a higher baseline.
- **Collisions.** Every carrier overlap the corpus produces is declared in
  `core/detection/collisions.json`. An undeclared overlap fails the sweep.
- **The golden file.** `contracts/fixtures/detection-golden.json` holds one
  `{ input, carrier, confidence, candidates }` entry per number, replayed by the
  native tests so the Swift port cannot drift from this one.

The generator runs the sweep in update mode rather than re-implementing
detection, so the golden file can only ever say what the engine says.
