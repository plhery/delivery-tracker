import { afterEach, expect, it, vi } from 'vitest';
import { authenticatedFetch } from './apiClient';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['token', 'request', 'refresh'])('bounds a stalled %s without signing out a recoverable session', async (stage) => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
  const never = () => new Promise<never>(() => {});
  const getAccessToken = vi.fn().mockImplementation(refresh => (stage === 'token' || (stage === 'refresh' && refresh)) ? never() : Promise.resolve('token'));
  const onAuthenticationFailure = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => stage === 'request' ? never() : Promise.resolve(Response.json({}, { status: 401 }))));
  const pending = authenticatedFetch('/api/packages', { userId: 'A', getAccessToken, onAuthenticationFailure });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(30_001);
  await rejected;
  expect(onAuthenticationFailure).not.toHaveBeenCalled();
});

it('does not sign out the next account when an old request returns unauthorized', async () => {
  const lifecycle = new AbortController();
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const onAuthenticationFailure = vi.fn();
  const getAccessToken = vi.fn().mockResolvedValue('token');
  const pending = authenticatedFetch('/api/packages', { userId: 'A', getAccessToken, onAuthenticationFailure, signal: lifecycle.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  lifecycle.abort();
  finish(Response.json({}, { status: 401 }));
  await rejected;
  expect(getAccessToken).toHaveBeenCalledOnce();
  expect(onAuthenticationFailure).not.toHaveBeenCalled();
});
