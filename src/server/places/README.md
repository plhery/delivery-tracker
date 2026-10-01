# Places

Carriers say where a scan happened in free text: "Härkingen", "LEIPZIG - DE", "Sort centre
Chicago IL", "FRANCE". `placesForEvents` turns each one into a map place, or into nothing.

## How a place is chosen

- The text is split into fields and phrases, and facility words ("hub", "Paketzentrum",
  "sort centre") are dropped. What is left is matched against town names, and translations
  for larger towns ("Genf", "Cologne").
- Bigger towns win, and context breaks ties: a country written in the text, a US state or
  Swiss canton code, a Swiss postcode, then the countries of neighbouring scans, the
  parcel's destination and the carrier's home country.
- A town nothing confirms needs 15,000 people. Otherwise the scan gets no place: a wrong
  dot is worse than none. Postcodes only confirm a name, never stand in for one.
- Text that names only a country gets that country, marked `country`, so the map shades
  the country instead of pinning a town.

Places are worked out each time the API returns a parcel, not stored, so a better
gazetteer improves every parcel at once. The gazetteer loads once per process. If
anything fails, parcels are served without places.

## Facilities

Some carriers say exactly where a scan happened, and the town's centre can be kilometres off:
Swiss Post's "Zürich Briefzentrum" is in Mülligen, 7 km west.

- `facilities.json` places sorting centres by the six-digit site number Swiss Post ends its
  scan text with ("Zürich Briefzentrum 801050"), whichever source relayed the scan. The text
  must also start with the site's town. Only sites seen in scans are listed, each with the
  OpenStreetMap element its point comes from. The first four digits are often not a
  postcode (8920 and 8520, the Urdorf and Frauenfeld parcel centres, are none), so unknown
  sites stay on their town.
- A carrier's own coordinates for a scan (`point` on the event, kept in `raw_data`) move it
  to the facility when they are within 30 km of the town its text names. Scans with the same
  text share a point, so a carrier that places some scans of an office keeps them together.

## Data

`node scripts/generate-places.mjs` builds `places.tsv.br`: GeoNames towns of 1,000 people
or more, the postal localities of Switzerland, Liechtenstein and their neighbours, Swiss
and Liechtenstein postcodes, and Natural Earth country label points. Decisions about
what to include are commented in the script.
Then run `node packages/carriers/scripts/generate-region-towns.mjs`: the carriers package keeps
the towns of a few US states and Canadian provinces from it (`npm run test:contract` checks).

GeoNames data is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
([geonames.org](https://www.geonames.org)) and facility points come from
[OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL); the privacy notice, linked
from the app, credits both. Natural Earth is public domain and needs no credit.
