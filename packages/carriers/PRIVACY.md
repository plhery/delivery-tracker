# Privacy policy for carrier data

Carrier responses describe other people's parcels. This package retains the
minimum an app needs to show progress and notify, and it does so in one place:
the projection step of every adapter (`parse()`), checked by the capability
guard test. The policy is stated here once; per-carrier READMEs only note
carrier-specific exceptions.

## Retained

- Status, stage, and the provider's status code where it has one.
- Event timestamps, with their offset when the provider gives one; otherwise a
  documented zone policy from `core/time`, never a guessed UTC.
- Operational locations: city, region, country, and the name of a parcel shop,
  locker or depot. Never a street address.
- The delivery estimate or window, removed once the parcel is delivered.
- Sender name when it is a webshop or business name.
- Pickup-point name, and the delivered-at time.
- Parcel weight and dimensions.
- The identifiers needed to follow a journey: the requested number, a canonical
  or partner number the provider echoes, and a handoff number.

## Never retained

- Recipient names, street addresses, phone numbers, e-mail addresses.
- Signatures, proof-of-delivery images or links, access codes, door codes,
  delivery instructions.
- Customer references, order values, payment or customs value data.
- Document URLs and raw provider payloads beyond the fields above. `raw_data`
  on a persisted event holds the projected event, not the provider response.

## Credentials

A postcode, a capability URL or a token that unlocks a shipment is part of the
tracking credential. It is stored with the parcel, used only for that lookup,
and never written to logs, issues, metrics, fixtures or documentation.

## Fixtures and samples

Fixtures built from real payloads must have every identifier replaced by a
made-up value that still satisfies the format and checksum (see `CORPUS.md`).
Real numbers given to us privately are never committed.

## Where the policy is enforced

- `core/result` validates the result shape and drops unknown event fields.
- Each adapter's `parse()` builds events from an explicit allowlist rather than
  copying provider objects; its offline test feeds a fixture containing
  recipient fields and asserts they are absent from the result.
- The host's logging boundary excludes tracking data from application logs.
