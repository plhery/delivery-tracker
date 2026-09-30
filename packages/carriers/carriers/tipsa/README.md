# TIPSA

Tracks TIPSA's 22-digit references through the shipment page its shop link opens. The
locator form on tip-sa.com also asks for the destination postcode; this page does not.

## How it works

1. `direct`: `GET https://aplicaciones.tip-sa.com/cliente/datos_prestashop.php?id={number}`,
   where the shop link (`www.tip-sa.com/cliente/datos_prestashop.php`) redirects. The reply
   is a meta refresh to `dinapaqweb.tipsa-dinapaq.com/dinapaqweb/detalle_envio.php` with a
   service id and a `dd/MM/yy` date. Empty parameters mean TIPSA knows no such reference:
   not found, after one request. Any other target is a changed page and is not followed.
   The shipment page is ISO-8859-1.

## Notes

- A 22-digit reference is the charge agency, the origin agency (six digits each) and the
  waybill (ten). The page must repeat the reference in its read-only field and in the
  three hidden agency and waybill fields.
- Only the history table is read. The recipient, sender, shop reference, postcode,
  destination agency address and proof of delivery on the same page are never read.
- Each history cell repeats its text in a tooltip span; only the visible span is read.
  ParcelsApp reads both, which is why it relays `ENTREGADOENTREGADO`.
- Times: the history keeps Madrid time for every agency, Portuguese ones included, and
  `timezone` is `Europe/Madrid`. The proof of delivery shows the local time: the same as
  the history's delivery row for deliveries in Spain, an hour earlier in Portugal.
- Labels map through `status.ts`; others fall to the shared Spanish wording rules, and
  stay unmapped when those don't know them either.
- Detection only suggests TIPSA: CTT Express numbers share the agency, agency, waybill
  layout, and every six-digit agency code seen so far starts with 0. Recognition asks
  TIPSA first for such numbers.

## Limitations

- Ten-digit waybills can't be looked up without their agency codes; recognition answers
  them as unknown without a request.
- References starting `00` (the `000010` account) match CTT Express's rule, which is
  high confidence, so they are filed as CTT Express until a universal provider names
  TIPSA.
- An expired history and an unknown reference get the same empty redirect.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/tipsa` sends a well-formed
unknown reference. Set `TIPSA_TRACKING_NUMBER` to a real reference to read one history.
