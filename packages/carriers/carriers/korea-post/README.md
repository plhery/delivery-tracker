# Korea Post

The adapter submits the official English international-mail form through HTTP.
It checks the parcel in the basic-information table before reading the history
table. Domestic numeric references use the universal providers.

The portal uses destination-local scan times after handover. The adapter
retains those wall clocks as `local_time` and reverses the portal's oldest-first
sequence without inventing offsets. `last_update` stays empty so providers can
supply dated history. The details column mixes routing notes and recipient data;
the adapter reads only the dedicated status and facility columns.

Run `npm run test:carriers:live -- packages/carriers/carriers/korea-post`.
Set `KOREA_POST_TRACKING_NUMBER` outside the repository for a real international
parcel.
