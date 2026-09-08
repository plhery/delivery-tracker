import 'server-only';
import { headers } from 'next/headers';

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first && first.length <= 253 ? first : null;
}

export async function requestOrigin(): Promise<URL> {
  const requestHeaders = await headers();
  const host = firstHeaderValue(requestHeaders.get('host'))
    ?? firstHeaderValue(requestHeaders.get('x-forwarded-host'))
    ?? 'localhost';
  const forwardedProtocol = firstHeaderValue(requestHeaders.get('x-forwarded-proto'));
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
