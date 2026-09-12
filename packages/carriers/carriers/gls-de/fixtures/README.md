# GLS Germany fixtures

| File | Scenario | Provenance |
| --- | --- | --- |
| `parcel-delivered.json` | One delivered parcel row as the GROUP service returns it, with a German scan location, the `REQUEST` owner code the detail call replays, and the recipient name and street the projection must drop. The tests reuse it as both the `rstt029` overview row and the `rstt028` detail body, and override `tuNo` for the mismatch cases. | Constructed in the shape of the public GROUP endpoints; the parcel number is synthetic. |
