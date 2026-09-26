# SF Express fixtures

These synthetic records preserve the shape of the official Taiwan anonymous
routes response observed on 2026-09-26. Identifiers, dates and locations are
invented. No live response, CAPTCHA assets, validation tokens, personal data or
phone verification input is committed.

The positive live reference returned 22 scans. `delivered.json` reduces that
shape to six representative milestones, including warehouse movement, customs
clearance, delivery round and recipient delivery. The offsetless scan dates
are intentionally retained as wall clocks. The public frontend displays the
same values without establishing a timezone.
