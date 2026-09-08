import { defineConfig } from '@playwright/test';

const port = process.env.PLAYWRIGHT_PORT ?? '4173';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Next's development compiler can leave chunk responses pending when every
  // desktop CPU is used for a cold, fully parallel browser run. Two workers
  // keep the test server responsive while still exercising concurrent pages.
  workers: 2,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'mobile-webkit',
      use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    // CI exercises the self-contained production server; test:dev separately
    // verifies that the development compiler can serve a real page.
    command: process.env.CI
      ? 'npm run build && npm start'
      : process.env.PLAYWRIGHT_PRODUCTION
        ? 'npm start'
        : `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    env: {
      HOSTNAME: '127.0.0.1',
      NEXT_PUBLIC_USE_API: 'false',
      PORT: port,
    },
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 120_000 : 30_000,
    url: baseURL,
  },
});
