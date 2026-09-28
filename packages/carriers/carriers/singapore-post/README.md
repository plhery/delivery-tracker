# Singapore Post

The adapter uses the tracking site's anonymous JSON event endpoint. The site
executes reCAPTCHA before submitting its form, but its event request contains
only the tracking number. No browser session or account is needed for this
endpoint.

Mail scans supply offsets; Speedpost scans can omit them. The adapter keeps
offset-free scans as `local_time`, retains the portal's newest-first sequence,
and leaves `last_update` empty when the latest scan has no verified instant.
Empty history for an existing item is inconclusive; only the explicit
identity-bound missing-item response means not found.

Run `npm run test:carriers:live -- packages/carriers/carriers/singapore-post`.
Set `SINGAPORE_POST_TRACKING_NUMBER` outside the repository for a real parcel.
