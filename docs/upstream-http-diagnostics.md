# Upstream HTTP error diagnostics

Rejected responses from `fetchBounded`, including La Poste's direct tracking feed,
carry an `UpstreamHttpError.diagnostics` object. Routing attaches it to Sentry's
`upstream_http` context before trying fallback; ordinary operational exceptions
retain it through their cause chain too.

The context contains the content type, server header, request/correlation IDs,
Retry-After in milliseconds when available, recognized body signatures and error
codes, and the actual textual error-response excerpt. Body excerpts are authorized
for troubleshooting and may contain tracking identifiers. All response headers are retained, including session/authentication headers, under the project's Sentry diagnostic policy. The error also retains the requested URL, method,
headers, textual request body and timeout. Network failures retain request context
and their original cause. No field-based redaction is applied.

Inspection stops after 8 KiB or 200 ms. `body_read` distinguishes complete, empty,
truncated, timed-out, unreadable and skipped binary bodies. Partial excerpts remain
available; a broken body never replaces the original HTTP status. Cancellation
cannot extend the inspection deadline. Successful responses and intermediate
responses being retried keep their existing behavior; callers handling HTTP error
responses themselves through `allowHttpError` retain ownership of those bodies.

`body_signals` are observed signatures, not proof of the cause of a rejection.
For example, `access_denied` alone does not identify an anti-bot vendor, and a bare
403 has no inferred challenge signature. Unknown JSON explanations remain in the
excerpt; only known error codes become searchable tags. Request IDs and excerpts
do not affect issue grouping. Diagnostics are cleared from unrelated/recovery
events. Console routing logs include status, content type, read outcome and signals;
the full bounded excerpt and IDs are in Sentry.
