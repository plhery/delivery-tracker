# YTO Express

A Chinese domestic express carrier with no adapter of its own: the universal providers
track it. [`status.ts`](status.ts) reads YTO's own scan labels when a provider relays
them.

## Notes

- ParcelsApp relays YTO's scan-type labels (`揽收扫描`, `派件扫描`, …) and sometimes serves its
  own English translation of the same scans ("Pickup scan", "Delivery scan", …). Both
  forms map to one stage and one stored wording, so a language switch does not store
  the history twice. Labels outside the list fall back to the shared wording rules.
- After a return scan (`退回件扫描`), YTO's delivery-side scans are the trip back: the
  final sign-for scan is the sender taking the parcel back. They are stored as the
  return leg with the `returned` stage, never as a delivery.
- ParcelsApp labels YTO's China wall clock as UTC. Mainland China has one clock, so the
  catalog zone `Asia/Shanghai` re-reads it; ZTO, Yunda and STO use the same zone.

## Limitations

- Only the labels seen in a real history are mapped. A problem or refusal scan stays
  pending until one is observed.
- 17TRACK sends full Chinese sentences with its own status codes, which give its stages.
