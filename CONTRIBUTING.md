# Contributing to Delivery Tracker

Thanks for helping improve Delivery Tracker. Keep changes focused,
explain the user problem they solve, and avoid including real shipment data in
code, tests, screenshots, logs, or issues.

## Local setup

1. Install Node 24.
2. Run `nvm use && npm install`.
3. Run `npm run dev` for the self-contained demo application.

Production mode needs a Supabase project and the server-only values documented
in `.env.example`. Never expose a service-role key through a `NEXT_PUBLIC_`
variable.

## Before opening a pull request

Run:

```bash
npm run lint
npm run typecheck
npm run test:scripts
npm run test:contract
npm run test:coverage
npm run test:coverage:server
npm run test:e2e
npm run build
npm run test:pwa
```

Install Chromium once before the first browser run with
`npx playwright install chromium`. The journeys run against the fictional demo
data at desktop and mobile viewport sizes.

Database changes must be append-only migrations with corresponding assertions
in `supabase/tests/assertions.sql`. Keep commits small enough to review on their
own and update the OpenAPI contract before changing generated API types.

## Carrier integrations

Every carrier is described by `packages/carriers/carriers/<id>/carrier.json`,
the single source of truth for its name, brand, timezone, portal, tracking
links and detection rules; `npm run carrier:new` scaffolds a folder and
`npm run contract:generate` merges them into `contracts/openapi.json` and the
generated TypeScript, Swift and package catalogs. Change the folder, not the
generated contract.

Carrier sites and undocumented APIs can change without notice. New adapters
must use bounded timeouts and response sizes, avoid personal-data logging, and
degrade to a carrier link when reliable automatic tracking is unavailable.
Every automatic carrier also needs a public, credential-free `canaryUrl` in the
carrier contract. The daily canary reports carrier IDs, hostnames, HTTP statuses,
per-attempt timing and bounded network error details (types, codes, syscalls and
failed IP addresses/ports, including nested causes). It records each attempt as
it completes, including failures that recover on retry, and prints the runtime
version and probe settings. It never sends or logs tracking numbers, and excludes
raw error messages, stacks, full URLs, headers and response bodies.

By contributing, you agree that your contribution is licensed under the
repository's Apache License 2.0.
