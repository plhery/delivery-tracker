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

## Data

`node scripts/generate-places.mjs` builds `places.tsv.br`: GeoNames towns of 1,000 people
or more, the postal localities of Switzerland, Liechtenstein and their neighbours, Swiss
and Liechtenstein postcodes, and Natural Earth country label points. Decisions about
what to include are commented in the script.

GeoNames data is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
([geonames.org](https://www.geonames.org)); the privacy notice, linked from the app, credits
it. Natural Earth is public domain and needs no credit.
