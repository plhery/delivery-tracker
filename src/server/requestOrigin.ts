import 'server-only';
import { headers } from 'next/headers';
import { movedOrigin, requestHost } from './siteHosts';

export async function requestOrigin(): Promise<URL> {
  const requestHeaders = await headers();
  const host = requestHost(requestHeaders) ?? 'localhost';
  let edgeProtocol: string | undefined;
  try {
    // The internal reverse proxy can replace X-Forwarded-Proto with HTTP.
    const { scheme } = JSON.parse(requestHeaders.get('cf-visitor') ?? '{}') as { scheme?: unknown };
    if (scheme === 'http' || scheme === 'https') edgeProtocol = scheme;
  } catch { /* Fall back to the usual proxy headers when absent or malformed. */ }
  const forwardedProtocol = edgeProtocol ?? requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const localHost = host === 'localhost'
    || host.startsWith('localhost:')
    || host === '[::1]'
    || host.startsWith('[::1]:')
    || host === '127.0.0.1'
    || host.startsWith('127.0.0.1:');
  const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
    ? forwardedProtocol
    : localHost ? 'http' : 'https';
  try {
    const origin = new URL(`${protocol}://${host}`);
    if (
      origin.username
      || origin.password
      || origin.pathname !== '/'
      || origin.search
      || origin.hash
    ) return new URL('http://localhost');
    return new URL(origin.origin);
  } catch {
    return new URL('http://localhost');
  }
}

/**
 * The origin a page rendered on a legacy host has moved to. Only the service
 * worker of that host is given such a page, for its app shell; the browser
 * that opens the shell reads this and follows.
 */
export async function requestMovedOrigin(): Promise<string | undefined> {
  return movedOrigin(await headers()) ?? undefined;
}
