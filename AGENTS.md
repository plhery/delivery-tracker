# Project instructions

- This is an open-source project. Repository files, code comments, commit messages, and pull request descriptions are publicly readable. Keep secrets, private tracking numbers, postcodes, and internal database-testing details out of them; use synthetic fixtures and supply private live-test inputs outside the repository.
- After completing a requested change in this repository, stage the files for that change, commit them, and push the commit directly to `main` without asking for separate permission.
- Do not create a feature branch or pull request unless the user explicitly asks for one.
- Before pushing, run validation appropriate to the changed areas and confirm that no secrets or unrelated generated artifacts are included.
- Carrier behaviour (catalog, detection, adapters, status wording, provider order, places) lives in [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper), an exact npm dependency. Change it there, release, then update the dependency here ([docs/SCRAPER.md](docs/SCRAPER.md)). Import only its published entry points.

## Documentation

- Keep docs short, plain and current. Describe how things work now: no dates, verification logs, changelogs, one-off measurements ("22 scans in 14.6 s") or hedging. Git history holds the history.
- Don't copy what a machine-readable source already holds: `contracts/openapi.json` (API, carrier catalog), `shared/analytics.json` (events), `shared/locales` (copy), the scraper's catalog and coverage data. No status tables or field tables in READMEs.
- Carrier adapters and provider documentation belong in [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper). App documentation covers routing, persistence and client behaviour.
- Keep one topic in one place: routing in `docs/ROUTING.md`, logs/audit/Sentry/metrics in `docs/OBSERVABILITY.md`, provider results in `https://github.com/plhery/universal-parcel-scraper/blob/main/providers/COVERAGE.md`. Link to files rather than section anchors.
- Update the docs in the same commit as the behaviour they describe. When a migration needs a rollout order, put it in the commit message, not the docs.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
