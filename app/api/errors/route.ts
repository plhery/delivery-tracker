import { apiRoute } from '../../../src/server/api';
import { forwardBrowserErrors } from '../../../src/server/browserErrors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The pages' error reports, on their way to Sentry (docs/OBSERVABILITY.md). Sentry's
// browser SDK posts them as plain text.
export const POST = apiRoute(({ request }) => forwardBrowserErrors(request), {
  authenticated: false, loadService: false, anyBody: true,
  publicRateLimit: { limit: 10, window: 600 },
});
