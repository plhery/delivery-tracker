import { analyticsConfiguration } from './src/server/analytics';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { APPEARANCE_BOOTSTRAP } from './src/lib/appearanceConfig';
import { ENTRY_HINT_BOOTSTRAP } from './src/lib/entryHintConfig';
import { LOCALE_COOKIE, pathLanguage } from './src/lib/locale';
import { MAIL_LINK_BOOTSTRAP } from './src/lib/mailLinkConfig';
import { publicSupabaseOrigin } from './src/server/runtime';
import { legacyHostRedirect } from './src/server/siteHosts';

// The app and static privacy document use this exact, fixed prepaint script.
const appearanceScriptHash = createHash('sha256').update(APPEARANCE_BOOTSTRAP).digest('base64');
// The app's second prepaint script: who is about to see the landing.
const entryHintScriptHash = createHash('sha256').update(ENTRY_HINT_BOOTSTRAP).digest('base64');
// The static privacy document's own script: it writes its scrambled addresses back.
const mailLinkScriptHash = createHash('sha256').update(MAIL_LINK_BOOTSTRAP).digest('base64');

export function proxy(request: NextRequest) {
  // A page opened on a host the site has left continues at the same address on its new one.
  const moved = legacyHostRedirect({
    method: request.method,
    headers: request.headers,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  });
  // Never stored: the answer depends on who asks, and a later change of hosts must take effect at once.
  if (moved) return NextResponse.redirect(moved, { status: 308, headers: { 'Cache-Control': 'private, no-store' } });

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDevelopment = process.env.NODE_ENV === 'development';
  const supabaseOrigin = publicSupabaseOrigin();
  const analyticsOrigin = analyticsConfiguration()?.endpoint;
  const connectSources = [...(analyticsOrigin ? [new URL(analyticsOrigin).origin] : []), "'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])].join(' ');
  const contentSecurityPolicy = `
    default-src 'self';
    base-uri 'none';
    connect-src ${connectSources};
    font-src 'self';
    form-action 'self';
    frame-src https://challenges.cloudflare.com;
    frame-ancestors 'none';
    img-src 'self' blob: data:;
    manifest-src 'self';
    object-src 'none';
    script-src 'self' 'nonce-${nonce}' 'sha256-${appearanceScriptHash}' 'sha256-${entryHintScriptHash}' 'sha256-${mailLinkScriptHash}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''};
    style-src 'self' 'unsafe-inline';
    style-src-attr 'unsafe-inline';
    style-src-elem 'self' ${isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`};
    worker-src 'self';
  `.replace(/\s{2,}/g, ' ').trim();

  // A language address such as `/de` is in its own language, whatever the browser prefers: the page is
  // rendered as if that language had been chosen. Only the request the page reads says so. The browser's
  // own cookie is not written, and no other address reads anything a client could not already choose.
  const language = pathLanguage(request.nextUrl.pathname);
  if (language) request.cookies.set(LOCALE_COOKIE, language);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: [
    {
      // The example email is not a page of the app: it answers with a policy and a lifetime of its own.
      // Nor are the files written for crawlers, which every host answers itself.
      source: '/((?!api|health|_next/static|_next/image|icons|sw\\.js|push-sw\\.js|og(?:-[a-z]{2})?\\.png|favicon\\.ico|robots\\.txt|sitemap\\.xml|\\.well-known/apple-app-site-association|email/example).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
    // A language address is always answered from here, a prefetch too: this is where the page learns its language.
    { source: '/:language(de|fr|it|es|pt|pl)' },
  ],
};
