# SF Express

Tracking uses the universal providers. A direct adapter is not implemented.

## Direct-source investigation

Checked **2026-09-26** against the official
[SF International tracking page](https://www.sf-international.com/us/en/support/querySupport/waybill)
and its current frontend bundles. Anonymous international queries use
`GET /site/core-service/web/bills/{ids}/routes`, with `app=bill`, a selected
`timeZone`, and a CAPTCHA ticket. The separate `nativeBills` endpoint serves
local SFIDP waybills; it is not a general substitute for international tracking.

A fresh browser lookup reached a Tencent slider puzzle before shipment history.
A direct HTTP request to the international route endpoint returned HTTP 200
with `code: 1`, `result: null`, and `detailMessage: "Captcha  verification failure"`.
That response is a verification failure, not evidence that the shipment is
unknown or has no history. No repeatable automated retrieval was demonstrated,
so the carrier remains routed through universal providers.

The international page separately directs Mainland China waybills to the
[domestic SF Express portal](https://www.sf-express.com/chn/en/waybill/list).
The domestic frontend has its own Geetest verification flow. A working
international lookup would therefore not establish coverage for every SF
Express service.

The [official route-query API](https://open.sf-express.com/Api/ApiDetails?interName=%E8%B7%AF%E7%94%B1%E6%9F%A5%E8%AF%A2%E6%8E%A5%E5%8F%A3-EXP_RECE_SEARCH_ROUTES&level3=397)
uses a partner integration and shipment-ownership or phone verification. It
does not establish an anonymous replacement for the public tracking flow.

Implementing a direct adapter requires repeatable retrieval of matching
shipment history, including service scope, returned identity, timestamps,
and verified handling of CAPTCHA and empty replies. A manually completed
puzzle alone would not establish automated support.

## TRAWL follow-up, 2026-09-26

The official [Taiwan tracking page](https://htm.sf-express.com/tw/en/dynamic_function/waybill/)
offers a different route: GeeTest v4 in bind mode, followed by
`/sf-service-core-web/service/bills/{number}/routes`. The installed
[TRAWL GeeTest solver](https://github.com/germondai/trawl/blob/v1.5.0/packages/tiers/src/solvers/geetest.ts)
supports sliders, but expects an initial verification button that bind mode
does not display. A fresh service lookup loaded the puzzle and failed at that
button; it captured no shipment response.

Isolated experiments skipped the missing button and bounded old-version
selectors. The stock solver reported success after one slide even though the
puzzle remained visible and no routes request completed. Its success check can
accept missing elements or visibility errors, and its gap calculation ignores
the slice's vertical position and transparent margins. The widget's entrance
animation also temporarily changes rendered geometry.

A subsequent prototype waited for stable dimensions and used the rendered-to-
native image scale. Template matching was not reliable across different puzzle
images, so it stopped rather than submitting a low-confidence answer. No new
matching tracking history was retrieved. This route remains a concrete option
for a better v4 gap detector with callback/response-based success validation;
enabling TRAWL's existing generic solver alone is insufficient. These probes
did not change the deployed solver or enable a direct carrier adapter.
