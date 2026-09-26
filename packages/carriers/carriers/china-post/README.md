# China Post

No dedicated adapter: China Post numbers go to the [universal providers](../../providers/README.md).
EMS items have their own official route in [`ems`](../ems/README.md), used when the user picks EMS
or pastes its link.

## Current route

- Checksum-valid `C…CN` and `L…CN` numbers try 17TRACK first, then the ordinary chain (Ship24,
  ParcelsApp, UPU last). The rule is `priorityUniversalSource` in
  [`providers/universal.ts`](../../providers/universal.ts).
- Why: 17TRACK returns much richer dated history for these families (both legs, including
  out-for-delivery) and handles China Post's Chinese sub-status codes. UPU's anonymous API often
  has only the final delivery or misses the latest milestones. Evidence is in
  [`providers/COMPARISON.md`](../../providers/COMPARISON.md).
- `E…CN` (EMS) and other formats keep ordinary discovery. `R` and untracked `U` mail were not
  evaluated.
- The official site shows only a two-event preview without login, so it is not a completeness
  reference either.

## Official site (ems.com.cn)

The tracker at `https://www.ems.com.cn/queryList` (and the English site) gates every lookup behind
an ordered Chinese-character click CAPTCHA.

- `POST /ems-web/cutPic/getPictureNew` returns `data.type: "WORD_IMAGE_CLICK"`, a challenge `id`, a
  background and a prompt image. The shape matches [Tianai CAPTCHA](https://github.com/dromara/tianai-captcha).
- The widget collects four ordered clicks. The lookup sends the challenge id as `capcode`, the clicks
  as `trackList`, and `time`/`ticket` headers derived from public frontend config. Reproducing the
  headers does not answer the challenge.
- Plain HTTP to the page and the `cutPic` / `currentTime` endpoints gets HTTP 405 with an HTML block
  page, not a not-found.
- TRAWL and Camoufox reach the page and receive the challenge, so transport is fine. The solver has
  nothing for character clicks (it handles Turnstile, reCAPTCHA audio, hCaptcha and GeeTest sliders).
- Full history needs a login even after the CAPTCHA, so solving it may only buy the preview.
- `capcode` is kept in local storage for the list-to-detail step. A solver must stay in the same
  browser context; exported cookies are not enough.

## Rejected approaches

- Official API platform (`api.ems.com.cn`, service `040001`): needs a contract customer code and a
  signed, encrypted payload. Not anonymous.
- `track-chinapost.com`: returns a "Getting data" shell behind reCAPTCHA v3 and an `_rtoken` cookie.
  Its HTTP 200 is misleading.
- ChinaPostalTracking: an iframe around the 17TRACK widget, calling the same
  `t.17track.net/track/restapi` our 17TRACK adapter uses. Unsigned requests get `meta.code: -14`.
  Not an independent source.
- Old slider solvers (e.g. AlienZaki/PostAPI, OpenCV matching on `cutPic/getPic`): built for the
  previous slider CAPTCHA, not the current click challenge; no license.
- Other GitHub clients wrap TrackingMore, 17TRACK or the credentialed EMS partner API. None is an
  anonymous scraper.
- EMS Cooperative (`items.ems.post`): answers "does not denote an EMS item" for ordinary `LZ…CN`
  mail, so it covers EMS only.

## What might work next

A vision solver for the four-click challenge, run in one browser context and tested for challenge
expiry and number binding. Only worth it if the login-gated history is acceptable.
