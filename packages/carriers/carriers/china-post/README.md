# China Post

China Post currently uses the [universal providers](../../providers/README.md).
There is no dedicated adapter in this folder. This investigation establishes a
CAPTCHA-free official route for **EMS items**, not every China Post service.
No production routing was changed.

## Official China Post challenge

Observed on 2026-09-21 in Chrome, using synthetic input:

- The catalog's old mail-tracking URL redirects to
  [the current tracking app](https://www.ems.com.cn/queryList).
- Submitting a number opens an ordered **Chinese-character click CAPTCHA**.
  The [English site](https://www.ems.com.cn/english/) displays the same kind of
  challenge, including Chinese instructions. Changing language does not avoid it.
- `POST /ems-web/cutPic/getPictureNew` returns JSON with
  `data.type: "WORD_IMAGE_CLICK"`, an issued challenge `id`, a background image,
  a separate prompt image and their dimensions. The extra `data` field was empty;
  it did not disclose answer positions.
- The widget collects four ordered clicks and emits normalized coordinates and
  timing fields. The tracking code carries the challenge id as `capcode` and
  transforms the click list into `trackList`. The request also uses `time` and
  `ticket` headers derived from public frontend configuration. Reproducing that
  signature alone does not reproduce the challenge answer.

The type and image-response field set match
[Tianai CAPTCHA's response model](https://github.com/dromara/tianai-captcha/blob/master/tianai-captcha/src/main/java/cloud/tianai/captcha/application/vo/ImageCaptchaVO.java).
This suggests a Tianai-compatible implementation; its backend version or fork
was not verified. It is not the slider puzzle used by the older scraper below,
and no reCAPTCHA/hCaptcha widget was observed in this China Post form.

There is also a separate HTTP protection layer. Plain requests to the old page,
`cutPic/getPic`, `cutPic/getPictureNew` and `currentTime/queryTime` returned
HTTP 405 with an HTML blocking page. Chrome reached the app and challenge JSON.
Those 405s are not shipment-not-found replies, nor evidence that the legacy
endpoints have been removed.

Current frontend evidence:

- [Character-click widget](https://www.ems.com.cn/js/chunk-57f065d3.10e05a4f.js).
- [Tracking flow](https://www.ems.com.cn/js/chunk-5b114696.3da48dd0.js).
- [API methods and click-list transformation](https://www.ems.com.cn/js/app~c714bc7b.7fce8b7a.js).

No successful omission of the challenge, automated solution of the current
puzzle, or reuse lifetime was established. A dedicated vision solver is a
possible engineering approach, not a verified capability of the existing
browser service. The evidence does not justify calling the CAPTCHA impossible.

## Working official alternative: EMS Cooperative

The [official EMS tracking page](https://www.ems.post/en/global-network/tracking)
embeds `https://items.ems.post/`. Its form submits a plain GET:

```text
https://items.ems.post/api/publicTracking/track?language=EN&itemId={number}
```

A fresh Node `fetch` with a browser User-Agent returned six tracking events for
the EMS reference in 82 ms. A separate Python request returned the same six
events in 91 ms. These are individual local measurements, not a production
benchmark. The reduced request used only the User-Agent override: no landing
page, cookie jar, Referer, API key, JavaScript execution or CAPTCHA answer.
Default Python urllib requests had returned 403; that did **not** establish a
browser/session requirement.

Keep live numbers outside the repository. A bounded reproduction with the
tested User-Agent is:

```sh
curl --get --max-time 15 \
  --user-agent 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36' \
  --data-urlencode 'language=EN' \
  --data-urlencode "itemId=${CHINA_POST_LIVE_NUMBER:?Set a reference number locally}" \
  'https://items.ems.post/api/publicTracking/track'
```

The response is server-rendered HTML. The result lists the requested identifier
and a table with date/time, status and location. An adapter would need to bind
that result to the requested number and preserve offset-less dates as local
wall time until timezone semantics are established.

Two controls define important limits:

- A real ordinary `LZ…CN` item returned HTTP 200 with “does not denote an EMS
  item.” This is a service restriction, not evidence that the shipment is absent.
- The synthetic, checksum-valid EMS-shaped `EB000000005CN` returned HTTP 200
  with “There were no results found.” Its table still contains a header and a
  message row; neither is a tracking event.

This route is a candidate for EMS-specific retrieval ahead of universal
fallback. It cannot replace fallback for all `CN` numbers. International EMS
milestones also do not establish parity with every domestic China Post scan.
Production network compatibility, status mapping, timestamps and routing
integration remain unverified.

## Other routes checked

All observations below are from 2026-09-21 on the local machine.

| Route | Evidence | Practical conclusion |
| --- | --- | --- |
| Existing [Ship24 adapter](../../providers/ship24/README.md) | Signed HTTP returned six events for the EMS reference in 413 ms, reporting `EMS Post`. The ordinary postal reference returned one delivered event in 1,895 ms, reporting `UPU`. A synthetic control returned HTTP 404. | Already usable through current routing. The second result is limited history, not proof of complete China Post scan coverage. |
| Existing [ParcelsApp adapter](../../providers/parcelsapp/README.md) | Direct calls for the EMS reference and a synthetic control each reached the 10-second transport deadline without a response. | Inconclusive for China Post coverage; no browser recovery was tested in this pass. |
| [UPU Global Track & Trace](https://globaltracktrace.ptc.post/gtt.web/) | Its current `Search.aspx` form displays a four-character image CAPTCHA and an article-number field. The [UPU links this service](https://www.upu.int/en/contact-us/postal-shipments) for participating countries. | A potential route for non-EMS mail, but successful retrieval was not established here. Its challenge differs from China Post's ordered word clicks. |
| [track-chinapost.com](https://track-chinapost.com/startairmail.php) | Both the landing page and old `result_china.php` POST returned an HTTP 200 “Getting data” shell. It loads reCAPTCHA v3 and obtains an `_rtoken` cookie before reloading. | The old HTML scraper is not currently a verified shortcut. HTTP 200 alone is misleading. |
| [17TRACK](../../providers/seventeentrack/README.md) | Already a universal provider; no new China Post-specific live probe in this pass. | Retain existing fallback; do not claim new verification. |

Positive references came from public shipment reports:
[EMS report](https://www.chinapostaltracking.com/qa/package-stuck-export-customskeep-pending-inspection-161051/)
and [ordinary postal report](https://www.chinapostaltracking.com/qa/demora-160174/).
The two records in `numbers.json` are SDK examples, explicitly not known live
shipments; they were not positive availability controls. Raw responses,
challenge tokens and live identifiers were not added as fixtures.

## GitHub prior art

| Project and inspected revision | Implementation | Relevance today |
| --- | --- | --- |
| [AlienZaki/PostAPI EMS](https://github.com/AlienZaki/PostAPI/blob/531de00e22a8b27017b44d0d35823c2693d0a675/EMS/ems_tracking_service.py), file last changed 2023-01-25 | Fetches `cutPic/getPic`, implements OpenCV edge/template matching for the slider, constructs `time`/`ticket`, then calls official tracking endpoints. | A solver implementation for the old CAPTCHA, without fresh success verification. Its `xpos`/slider protocol differs from the current `trackList`. No repository license was found; it was not copied or executed. |
| [hdnpt/geartrack](https://github.com/hdnpt/geartrack/blob/acc345d96ad1aa4c280d50a443b4d3be5f37d5cb/src/trackChinaPost.js), file last changed 2017-06-27, MIT | Posts `order_no` to third-party `track-chinapost.com/result_china.php` and parses a table. | Does not bypass the official CAPTCHA. The endpoint now presented the reCAPTCHA shell above. |
| [slince/shipment-tracking](https://github.com/slince/shipment-tracking/blob/7e5a4c65ef9c59ec34a8b17716f01dfab050605f/src/EMS/EMSTracker.php), file last changed 2017-10-31 | Uses the EMS partner API with a caller-supplied `authenticate` header. | An authenticated integration, not an anonymous scraper. No license file was found in the inspected root. |
| [bernalli/parcel-tracker-bot](https://github.com/bernalli/parcel-tracker-bot/blob/cc3656216346d07436cb9018393191abffd6b45a/src/parcel_tracker/trackers/china_post.py), inspected 2026-09-21, MIT | Recognizes China Post numbers and delegates to its Track17-backed base class. | Aggregator delegation, not a direct scraper. |
| [clooney/china-post-tracking-api](https://github.com/clooney/china-post-tracking-api/tree/9333e321824a6090817bc265b1a1169ab7ca496e), last commit 2024-08-29 | TrackingMore API integration documentation. | Requires a provider API credential; the name does not indicate a free reverse-engineered endpoint. No repository license was reported. |

The most concrete next implementation is the single-request EMS Cooperative
route, with strict EMS eligibility and universal fallback. Solving the China
Post character CAPTCHA is a separate option if broader official-site history
is needed and a reliable, bounded solver can be demonstrated.
