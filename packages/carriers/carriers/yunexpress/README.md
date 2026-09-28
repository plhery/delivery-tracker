# YunExpress

The adapter loads the official Yuntrack page and captures its tracking API
response. Plain HTTP is rejected by the site's request protection even with the
current public browser signature. The browser creates the request signature and
anonymous authorization header itself; the adapter retains no session material.
The local browser keeps ordinary resource loading because intercepted network
requests are rejected by the site's protection.

Configure a Chromium executable for local browser capture. When no local
executable is configured, the adapter can use a Trawl browser service that
returns the decoded API body. Stock Trawl capture does not decode this site's
protected response, so it is skipped when local Chromium is configured.
An interactive verification remains a challenge and falls back to the providers.

The response's latest-event record supplies an offset for that exact scan.
Earlier scans often contain only local wall clocks, retained as `local_time`
in portal order. Storage timezone fields never supply scan offsets. The
downstream reference is retained for separate carrier confirmation.

Run `npm run test:carriers:live -- packages/carriers/carriers/yunexpress` with a
configured browser. Set `YUNEXPRESS_TRACKING_NUMBER` outside the repository to
check a real parcel.
