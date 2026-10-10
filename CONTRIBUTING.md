# Contributing

Thanks for helping. Keep changes focused and explain the user problem they solve.

**Keep private shipment data out** of code, tests, screenshots, issue logs and commit
messages. Use synthetic values in fixtures, and sanitize captures and diagnostic exports
before sharing them. Published tracking numbers and live carrier tests belong to the
scraper; see its [corpus](https://github.com/plhery/universal-parcel-scraper/blob/main/CORPUS.md).

## Setup

```bash
nvm use        # Node 26
npm install
npm run dev    # self-contained demo, no account or database needed
```

The demo's sample parcels live in `shared/delivery-demo.json` in English, with their
translations in `shared/demo-locales/`; the demo writes them in the app's language.

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
- **Carriers** live in [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper):
  fix an adapter or [add a carrier](https://github.com/plhery/universal-parcel-scraper/blob/main/CONTRIBUTING.md)
  there, then [update the dependency](docs/SCRAPER.md) here. Never edit the generated
  carrier catalog in the contract by hand.
- **Privacy notice**: edit `PRIVACY.md`, then run `npm run privacy`. It writes
  `public/privacy.html`, the page both apps open.
- **Help page**: edit `SUPPORT.md`, then run `npm run support`. It writes
  `public/support.html`.
- Keep commits small enough to review on their own.

By contributing, you agree that your contribution is licensed under the
repository's Apache License 2.0.
