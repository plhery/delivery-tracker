# 4PX

The public tracking site sends an anonymous JSON request to its tracking API.
The adapter selects the exact requested parcel and keeps its newest-first scan
order. Multi-package orders require separate parcel histories and fall back to
the providers.

The portal displays each scan's `tkDateStr` with `tkTimezone`. The adapter uses
that pair because `tkDate` carries different clock digits. A scan without an
offset is retained as `local_time`, without an invented instant. The server
reference can identify a delivery partner's tracking number; provider discovery
confirms the operator separately.

Run `npm run test:carriers:live -- packages/carriers/carriers/four-px`.
Set `FOUR_PX_TRACKING_NUMBER` outside the repository to check a real parcel.
