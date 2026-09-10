# Scraper transport review — September 10, 2026

Ship24 now uses one anonymous JSON POST per lookup. The production container returned matching delivered histories for two public examples: 32 normalized events in 409 ms and 6 in 121 ms. Previous browser lookups took approximately 2–3 seconds. Other adapters retain their existing transports until a cheaper path is verified.

## Findings

| Provider | Existing path and evidence | Decision |
| --- | --- | --- |
| Ship24 | Official frontend makes a signed POST, not a GET. Public checksum constants and algorithms are sufficient; no issued token, browser fingerprint, cookie, or account is required for the two verified examples. | Use one POST first; keep browser recovery. |
| ParcelsApp | Current bundle constructs protected fields including `se`. Both inspected anonymous crawlers use Chromium and capture `/api/v2/parcels`; the PHP API client requires an API key. A raw HTML GET loads the application rather than established shipment history. | Retain TRAWL. No browser-free replacement verified in this review. |
| 17TRACK | Initial unsigned POST probes returned HTTP 200 with rejection codes `-14` (current endpoint) and `-10` (legacy endpoint), not history. The old Python client uses a 2019 endpoint; the newer JS client requires login. The maintained multi-carrier integration uses an API key. | Retain the verified TRAWL capture. These probes do not prove every possible direct request is impossible. |
| Mondial Relay | Already uses two direct HTTP requests: page/cookie/token bootstrap, then JSON tracking. TRAWL is recovery after session rejection. Reviewed alternative libraries use merchant credentials. | Keep the direct path; no simpler verified anonymous replacement found. |
| UPS | Already caches a cookie/XSRF session and calls JSON directly, with TRAWL bootstrap/recovery. | Keep. Account-based integrations are not drop-in anonymous replacements. |
| DHL / DHL eCommerce | Direct structured tracking already comes first. Browser recovery addresses session rejection; earlier DHL eCommerce cookie transfer back to Node failed, while same-browser response capture succeeded. | Keep the recently verified recovery. |
| DPD Switzerland | Direct guest JSON protocol already exists, including token caching. TRAWL is a page fallback. | Keep; no justified replacement of the working guest protocol found. |
| DPD France | Starts with one direct HTML GET; TRAWL handles the page challenge. | Keep. JSON alone would not be an improvement over a working single GET without simpler retrieval evidence. |
| Postal Ninja | Existing two-step check/get JSON protocol was already identified, but signing alone did not resolve verification in earlier tests. A GitHub integration found in this review uses the separately provisioned RapidAPI service. | Remain opt-in; no new unattended success demonstrated. |

## Ship24 protocol and operational limits

The inspected [official frontend](https://cdn.ship24.com/assets/main.16f5bc7c0914804e.js) builds `x-ship24-token` from a timestamp, an opaque SHA-256 digest, a MurmurHash3 checksum bound to the tracking number, and an HMAC. Its HMAC input constant and checksum salt are public frontend configuration, not account credentials. The adapter documents that source and reproduces the small algorithm independently; it never executes downloaded scripts or stores captured tokens.

Verification separated method, signing, and transport:

1. GET against the API returned 404; the actual method is POST with a JSON body.
2. POST without its token returned 403. A freshly signed POST returned HTTP 201 with the matching shipment.
3. Fetching public configuration at runtime worked on the host but failed inside Docker. Explicit host probes returned 403 over IPv4 and 200 over IPv6 for the page. Both the page and asset CDN were blocked by CloudFront inside the container. Browser success did not establish that Node could fetch those bootstrap resources.
4. Referencing the reviewed public constants directly removed those bootstrap calls. The exact adapter then succeeded from Docker over its normal connection, using one POST per lookup. The two raw histories had 33 and 7 entries; existing normalization retained 32 and 6.

No IP rotation, proxy, container network change, paid service, or extra dependency was added. If the public signing scheme changes, the eight-second HTTP fast path reports its failure to Sentry and can use the existing browser with the remaining overall lookup budget. HTTP 429 and 5xx do not trigger a redundant browser attempt. Tests cover identity rejection, signature/checksum structure, input validation, recovery ordering, total budget, and rate-limit preservation. Two examples establish those successful lookups, not universal coverage.

## Prior implementations inspected

Repository update timestamps can reflect metadata rather than code changes. The revisions below identify the implementation actually inspected. No code, saved cookies, proxy settings, credentials, or disabled TLS checks were copied from these repositories.

- [kamushadenes/tracker17](https://github.com/kamushadenes/tracker17/blob/6d87ce44b7d9db95085c70759633d95e9fd5547c/tracker17/__init__.py), revision `6d87ce4`, last commit October 2019: historical anonymous endpoint.
- [mderazon/seventeen-track-js](https://github.com/mderazon/seventeen-track-js/blob/b8000c9/src/profile.ts), revision `b8000c9`, January 2026: account sign-in and buyer API.
- [thefuga/parcelsapp-crawler](https://github.com/thefuga/parcelsapp-crawler/blob/e3085dc9a3144829d0689a4f12705f61a87258ec/main.go), revision `e3085dc`, October 2022: browser widget submission and response capture.
- [dustindog101/parcelsapp-cli](https://github.com/dustindog101/parcelsapp-cli/blob/b0c57c2/parcels.py), revision `b0c57c2`, March 2026: browser navigation and response capture. Its claims about fingerprinting are hypotheses until independently verified.
- [locky42/parcels-app-provider](https://github.com/locky42/parcels-app-provider/blob/708726c/src/ParcelsAppProvider.php), revision `708726c`, June 2024: API-key-based tracking submission/polling.
- [TA2k/ioBroker.parcel](https://github.com/TA2k/ioBroker.parcel/blob/3c4fb0e/main.js), revision `3c4fb0e`, July 2026: useful multi-carrier reference, but its 17TRACK route requires an API key and several carrier flows require accounts.
- [frontBOI/mondial-relay](https://github.com/frontBOI/mondial-relay): merchant WebService client, not an anonymous public-tracking shortcut.
- [IrisKoBar/app_delivery_tracking](https://github.com/IrisKoBar/app_delivery_tracking): Postal Ninja RapidAPI integration.

Search GitHub early for provider/product names and exact endpoint strings, then inspect code, commit age, issues, and license. Verify leads against the current official frontend and the application container before replacing an adapter.
