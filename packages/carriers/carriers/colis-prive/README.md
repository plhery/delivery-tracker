# Colis Privé

French private parcel network (door, relay point, locker). Tracked by parsing
the public "Mon Colis" detail page, which needs the shipment number plus the
recipient's postcode.

## How it works

1. `direct`: one GET of
   `https://colisprive.com/moncolis/pages/DetailColis.aspx?numColis={credential}&lang=fr`
   with `redirect: 'manual'`. No session, token or JSON feed: the page is
   server-rendered HTML.
   - A 404 or any 3xx is not-found (`ColisPriveTrackingError`): an unknown
     shipment is bounced to the search page instead of answering 404.
   - Other non-2xx statuses throw `UpstreamHttpError`.
2. `parse()` removes `.divDesti` (recipient name and address), requires the
   `.BandeauInfoColis` banner, checks the displayed 12-character number matches
   the credential, then reads the status banner and timeline rows.

## Notes

- The credential is 12 alphanumerics followed by the 5-digit French postcode,
  stored as one value. The postcode is what opens the page, so treat the whole
  value as a secret: never log it, quote it in an issue or put it in a fixture.
- `.divDesti` is removed before any text is read, not filtered afterwards — a
  later selector can forget a filter, not a removal.
- A page for another shipment is a schema error, never a result.
- The timeline prints `DD/MM/YYYY` with no clock. The raw string stays the event
  time; `dateKey()` only builds a sort key and rejects impossible dates. Same-day
  events keep page order.
- Wording only, no status codes. Exception and return phrases are checked before
  delivery ones, because "nous avons tenté de livrer" contains "livrer".
- "subi un retard" maps to `failed_attempt`.
- Unmatched wording gets no stage; the sync classifies it and records it for
  review.
- `ColisPriveTrackingError` stays a named `NotFoundError` subclass: host sync
  tests and the live suite match on its name, and `error_type` is a Sentry label.

## Rejected approaches

- Splitting the credential into `input.number` and `input.postcode`: the
  combined value is what parcels store and what detection matches. Changing it
  is a data migration.
- Treating the 3xx bounce as a transport failure: it is the provider's stable
  not-found answer.

## Limitations

- History only: the page has no scan location, delivery estimate or weight.
- Undocumented HTML; markup changes fail loudly as schema errors.
- Recipient name and address are never read; the offline test asserts it.

## Testing

`npm run test:carriers:live -- src/server/frenchDirectCarriers.live.test.ts`
(no env vars) checks a wrong number maps to a clean not-found.
