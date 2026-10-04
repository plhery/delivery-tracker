import { randomBytes } from 'node:crypto';
import { apiRoute, HttpError } from '../../../../../src/server/api';
import { turnstileSettings } from '../../../../../src/server/lookupVerification';
import { isLocale } from '../../../../../src/lib/locale';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The token goes to the app, which exchanges it through its own network connection. */
export const GET = apiRoute(async ({ request }) => {
  const settings = turnstileSettings();
  if (!settings) throw new HttpError(503, 'Browser verification is not configured');
  const language = new URL(request.url).searchParams.get('language');
  const nonce = randomBytes(16).toString('base64');
  const config = JSON.stringify({ sitekey: settings.siteKey, language: isLocale(language) ? language : 'en' }).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="${isLocale(language) ? language : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Peek</title>
<style nonce="${nonce}">html{color-scheme:light dark}body{margin:0;display:grid;place-content:center;min-height:70vh;font-family:system-ui}#check{min-height:65px}</style>
</head><body><div id="check"></div><script nonce="${nonce}">
function send(type,token){window.webkit?.messageHandlers?.peekVerification?.postMessage({type,token});}
function ready(){const config=${config};window.turnstile.render('#check',{...config,action:'parcel_lookup',appearance:'interaction-only',theme:'auto','response-field':false,
callback:token=>send('token',token),'error-callback':()=>{send('error');return true;},'timeout-callback':()=>send('error'),'expired-callback':()=>send('error')});}
</script><script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&amp;onload=ready" async defer></script></body></html>`;
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'nonce-${nonce}'; frame-src https://challenges.cloudflare.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  } });
}, { authenticated: false, loadService: false, publicRateLimit: { limit: 30, window: 60 } });
