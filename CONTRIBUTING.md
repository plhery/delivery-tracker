# Contributing

Thanks for helping. Keep changes focused and explain the user problem they solve.

**Keep private shipment data out** of code, tests, screenshots, issue logs and commit
messages. Use synthetic values in fixtures. Published tracking numbers may go in the
[corpus](packages/carriers/CORPUS.md) with their source. Real numbers for live tests belong
outside the repo, or in the git-ignored `private.numbers.json` or `.private/`. Sanitize
captures and diagnostic exports before sharing them.

## Setup

```bash
nvm use        # Node 24
npm install
npm run dev    # self-contained demo, no account or database needed
```

Production mode needs Supabase and the server values in `.env.example`. Never expose a
service-role key through a `NEXT_PUBLIC_` variable.

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm run test:scripts
npm run test:contract
npm run test:coverage
npm run test:coverage:server
npm run test:e2e        # first time: npx playwright install chromium
npm run build
npm run test:pwa
```

The browser tests use the fictional demo data at desktop and mobile sizes.

- **Database changes** are new, append-only migrations, with assertions in
  `supabase/tests/assertions.sql`.
- **API changes** start in `contracts/openapi.json`; regenerate the types from it.
- **Carriers**: edit the carrier's folder, never the generated contract. See
  [adding a carrier](packages/carriers/README.md).
- Keep commits small enough to review on their own.

By contributing, you agree that your contribution is licensed under the
repository's Apache License 2.0.
