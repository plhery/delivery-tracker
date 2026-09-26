# Provider tradeoffs

Why the sources have different roles. The runtime policy is in
[docs/ROUTING.md](../../../docs/ROUTING.md) and per-carrier results are in
[COVERAGE.md](COVERAGE.md).

| Source | Why use it | Limits and cost | Role |
| --- | --- | --- | --- |
| Dedicated carrier | Direct identity and carrier-specific detail; can confirm the delivery partner | Coverage and anti-bot protection vary; some need a postcode or capability URL | First when available |
| [Ship24](ship24/README.md) | Fast signed anonymous HTTP; broad coverage; carrier hints | Website protocol can change; browser recovery is slower; some histories are sparse | First universal; keeps affinity |
| [ParcelsApp](parcelsapp/README.md) | Often fuller history; accepts a delivery postcode | Cold lookups are slow; TRAWL recovery; duplicate or translated scans; forecast rows projected | Second universal; keeps affinity |
| [17TRACK](seventeentrack/README.md) | Broad coverage; structured per-leg history | Needs the browser service and its compatibility build; verification and polling add seconds | First for China Post `C`/`L`; otherwise after the HTTP providers |
| [Postal Ninja](postal-ninja/README.md) | Alternative aggregator with full history through TRAWL | Browser verification; local Chromium is compact-only; direct HTTP is challenged | Opt-in, before 17TRACK |
| [UPU](upu/README.md) | Official documented anonymous API; one cheap GET, no CAPTCHA | Postal S10 only; sparse, sometimes stale; unreliable offsets; no known quota or SLA | Last; never sticky, never a shadow replacement |
| [EMS Cooperative](../carriers/ems/README.md) | Official express-post route; had a scan UPU lacked | EMS only; its own session protections | Service-specific source |
| [China Post website](../carriers/china-post/README.md) | Operator's own site | Ordered Chinese-character click CAPTCHA; only two events without login | Not used unattended |

A successful lookup proves neither complete history nor reliable timestamps, and says
nothing about API usage rights.

## Why this order

- **Dedicated adapters first:** they confirm identity and carry details aggregators lose,
  such as pickup-ready and locker-ready rows and the delivery method.
- **Ship24 first among universals:** its signed POST usually answers in under a second,
  with broad coverage. Its histories can be sparse for a given parcel, so a richer
  provider that has succeeded keeps affinity.
- **ParcelsApp second:** often the fullest destination leg, and the only provider that
  uses a postcode. Cold lookups can take tens of seconds.
- **17TRACK third:** a browser capture costs seconds and depends on the TRAWL build. It
  also offers the best multi-operator histories.
- **Postal Ninja opt-in:** it works only while the widget's browser check passes.

## Why UPU stays last

- It answers in milliseconds but is sparse, often final delivery only, and can be a
  milestone behind. With first-success-wins routing it would hide newer and fuller data.
  In an eight-reference postal comparison, every UPU success also succeeded on Ship24, and
  Ship24 had a newer milestone for a French item.
- Its offsets are unreliable (a Finnish delivery was an hour off Posti's own time), so
  it cannot prove freshness against other feeds.
- Its value is cheap, independent recovery when the others fail. Never promote it
  because it answered during another provider's outage.
- The host archives UPU scans instead of letting a shorter history replace a richer one.
  Polling cannot recover scans UPU never returned.

## China Post: 17TRACK first

Checksum-valid non-EMS China Post numbers (`L…CN` tracked letter, `C…CN` parcel, per the
[UPU S10 service table](https://www.upu.int/UPU/media/upu/files/postalSolutions/programmesAndServices/standards/S10-12.pdf))
start with 17TRACK.

- **Why:** for three public references (China to Brazil, Venezuela and the USA), 17TRACK
  returned the China Post leg and the destination leg (Correios, USPS), including
  out-for-delivery and delivery. UPU, Ship24 and ParcelsApp returned only final
  delivery, a few export scans, or timed out. Ship24 relays UPU for these numbers: its
  courier name is `UPU`. The cost is a few seconds of browser time.
- ChinaPostalTracking's tracker is 17TRACK's public widget on the same `track/restapi`
  endpoint, so no separate integration is needed.
- The official China Post site shows only the two latest events without login.
- **Scope:** `E…CN` (EMS) keeps its dedicated route. Untested formats and invalid
  checksums keep ordinary discovery. Dedicated adapters and confirmed destination routes
  still come first.
- **Caveats:** counts include overlapping per-operator rows, and 17TRACK can infer offsets
  (the China Post leg put `+08:00` on a wall clock USPS reported at `-07:00`). A scoped
  17TRACK success therefore skips timestamp-based shadow comparisons.
- Revisit if 17TRACK access or its comparative freshness changes.

## Other findings

- UPU, Ship24 and ParcelsApp on eight public postal references (China EMS, China Post,
  PostNL to Posti, French post, DHL, two Royal Mail, DPD): each returned history for
  four or five. UPU returned empty bodies for the DHL, Royal Mail and DPD items.
- ParcelsApp's old 10 s direct cap produced timeouts on slow cold lookups. This led to
  the 30 s cap plus one network retry.
- ParcelsApp keeps an `Estimated delivery` row as an event (seen in a China EMS history).
  This is still open.
- UPU's structured event codes give clean acceptance, customs and delivery stages, but
  clean structure does not mean complete history.
