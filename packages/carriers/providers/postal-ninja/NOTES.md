# Postal Ninja notes

## Decisions

- **Opt-in only (2026-09-10).** No unattended success has been demonstrated for
  the direct protocol, so the provider is excluded from the chain unless
  `TRACKING_ENABLE_POSTAL_NINJA=true`. When enabled it runs before 17TRACK,
  which stays last.
- **Submit the embedded widget, do not navigate to a number.** The official
  widget on `/en/tools` passes an automatic browser check; the main tracking
  page can instead require an interactive challenge, and opening a URL that
  contains the number performs no lookup at all.
- **Untick "save this parcel".** The lookup must not leave a stored parcel
  behind in the provider's own account-less storage.
- **Local wall times are preserved, never converted.** `dt` values have no zone
  even when several countries are involved. They are kept as `local_time`, the
  provider's own order is preserved instead of sorting mixed wall times against
  UTC instants, and an undated newest scan leaves `last_update` null rather than
  fabricating an instant from the destination zone.
- **Identity is checked four ways.** `status: FOUND`, the echoed number, the
  handle matching the reply's own `hid`, and a tracked state. A challenge reply
  (`CHLNG_REQ`) or a mismatched handle is not history.

## Rejected alternatives

- **The direct check/get JSON protocol with request signing (2026-09-10).**
  Identified, but signing alone did not resolve verification in the tests run.
- **The RapidAPI integration** (`IrisKoBar/app_delivery_tracking`): uses a
  separately provisioned paid service.
- **Sorting the projected events.** Wall times sort only approximately against
  UTC instants; for a provider that omits offsets everywhere, the provider's own
  order is the more reliable one.

## Verification log

- 2026-09-10: widget submission and `/track/get` capture verified in a fresh
  Chromium session; no account, saved login or cookie involved.
- 2026-09-10: direct protocol verification unresolved; provider remains opt-in
  and is not counted as coverage.
- 2026-09-12: moved into `packages/carriers/providers/postal-ninja`; the lookup
  is now run by `runSteps` with the step id `browser` and the unchanged
  `Postal Ninja` label.
