# Deployment recovery

Apply `20260912200000_deployment_recovery.sql` before deploying this worker.
The migration is backward compatible; readiness requires its `check_in` column.

On SIGTERM/SIGINT, the process immediately becomes unready and stops scheduling,
claiming and dispatching new background work. It aborts active tracking and
atomically hands its own job back to the queue. This also closes running audit
entries as `interrupted`, preserves the Sentry check-in, and restores the retry
attempt consumed by a normal deployment. A pending claim is handed back too.
Next's existing shutdown handler then drains HTTP requests. Shutdown is bounded:
6.5 seconds for the background handoff, 500 ms for Sentry, and a 25-second overall
watchdog. Set Coolify's application **Stop Grace Period** to **30 seconds**.

SIGKILL, host failure and failed handoffs recover through a **90-second job lease**,
renewed every 15 seconds during healthy work. A crash can therefore delay recovery
by up to 90 seconds plus queue polling and database availability, instead of 15
minutes. Reclaimed crashes are reported to Sentry. Three crash attempts remain
the limit; repeated orderly deployments do not exhaust it. Provider-level
cooldowns/leases retain their independent limits and are not forcibly cleared.

Database checks use ownership and the database clock, not the process clock.
Package/event writes, audit creation, lease renewal, check-in persistence, job
completion and handoff are fenced against the prior owner. Startup never clears
another worker's live lease, so overlapping containers can share the queue.
The replacement closes the original Sentry check-in only after actual completion.

Readiness requires a recent worker heartbeat, no active drain, and a successful
database/schema probe. `/health/live` remains a separate process-only probe.
Health failures prevent a new version from replacing the healthy deployment;
they do not by themselves promise that Docker will restart an unhealthy process.

Coolify must enable **Include Source Commit in Build**. Docker passes the immutable
commit to `NEXT_DEPLOYMENT_ID`; Next includes this version in assets and navigation
responses, allowing stale browsers to reload on a version mismatch. This does not
retain old static assets or route requests to old deployments.

`npm run test:deployment` exercises the built standalone server against a fake
database: interrupt a held operation, verify immediate handoff and normal Next
shutdown, then start a fresh server and finish the same job. It also checks the
deployment ID when configured. CI runs it after the production build. SQL tests
exercise ownership fencing, audit closure and repeated handoffs in an isolated
database; unit tests cover delayed claims, stuck operations and shutdown deadlines.
