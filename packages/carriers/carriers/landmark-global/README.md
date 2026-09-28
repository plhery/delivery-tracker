# Landmark Global

Tracks individual LTN references through the official anonymous portal,
including the portal's canonical identity for references ending in N1.

## How it works

One bounded GET retrieves the server-rendered history. The canonical parcel
identity must match, and the latest summary must agree with the first scan.
Multi-parcel pages are rejected. An exact absence message is accepted only when
the requested reference is retained in the page's search field.

## Notes

Scans retain their local clocks and provider order. The page supplies one
current server offset for browser display, which does not establish historical
DST offsets. No instant or delivery timestamp is inferred from it or the scan's
country. The host archives unresolved clocks and asks providers for dated
progress. The structured delivery-partner reference is preserved when
unambiguous. Order references, package references and payment actions are
excluded.

## Live test

Set `LANDMARK_GLOBAL_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/landmark-global/adapter.live.test.ts`.
Optionally set `LANDMARK_GLOBAL_UNKNOWN_NUMBER` to check explicit absence.
