import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invitationCode, invitationURL, INVITATION_STORAGE_KEY, openPendingInvitation, usePendingInvitation } from './friendInvites';

import { createHash, webcrypto } from 'node:crypto';

const code = 'ab'.repeat(16);
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); history.replaceState(null, '', '/'); });
it('accepts only complete trusted links and keeps their token out of HTTP requests', async () => {
  const url = await invitationURL(code);
  expect(invitationCode(url)).toBe(code);
  expect(new URL(url).pathname).toBe('/invite');
  expect(new URL(url).searchParams.get('preview')).toBe(createHash('sha256').update(code).digest('hex'));
  expect(new URL(url).search).not.toContain(code);
  expect(invitationCode(`${location.origin}/invite#${code}`)).toBe(code);
  for (const invalid of [code, `https://evil.example/invite#${code}`, `${location.origin}/invite?name=Paul#${code}`, `${location.origin}/invite#short`, `${location.origin}/invite?preview=short#${code}`, `${url}&extra=1`, url.replace('?preview=', '?preview=duplicate&preview='), url.replace('/invite', '/other'), url.replace('ab', 'AB')]) expect(invitationCode(invalid)).toBeNull();
});
it('keeps sharing functional when Web Crypto is unavailable', async () => {
  vi.stubGlobal('crypto', {});
  expect(await invitationURL(code)).toBe(`${location.origin}/invite#${code}`);
});
it('strips the fragment, remembers opening through OAuth, and clears after accepting', async () => {
  history.replaceState(null, '', await invitationURL(code));
  const first = renderHook(() => usePendingInvitation());
  await waitFor(() => expect(location.hash + location.search).toBe(''));
  act(() => first.result.current.setOpened(true));
  first.unmount();
  history.replaceState(null, '', '/?code=oauth-authorization-code');
  const restored = renderHook(() => usePendingInvitation());
  expect(restored.result.current.pending).toMatchObject({ code, opened: true });
  expect(sessionStorage.getItem(INVITATION_STORAGE_KEY)).not.toMatch(/nickname|Paul/);
  act(() => restored.result.current.clear(true));
  expect(restored.result.current.pending).toBeNull();
  expect(sessionStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
  expect(location.search).toBe('?view=friends');
});
it('keeps a consumed invitation only for the receipt animation and protects replacement links', async () => {
  const hook = renderHook(() => usePendingInvitation());
  await act(async () => openPendingInvitation(await invitationURL(code)));
  act(() => { expect(hook.result.current.markAccepted()).toBe(true); });
  expect(hook.result.current.pending).toMatchObject({ code, opened: true, accepted: true });
  expect(sessionStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
  expect(location.pathname + location.search).toBe('/?view=friends');
  const oldReceipt = hook.result.current;
  await act(async () => openPendingInvitation(await invitationURL('cd'.repeat(16))));
  act(() => { expect(oldReceipt.markAccepted()).toBe(false); oldReceipt.clear(true); });
  expect(hook.result.current.pending?.code).toBe('cd'.repeat(16));
  act(() => hook.result.current.clear());
});
it('replaces an old invitation, rejects an expired one, and dismisses to the unopened start', async () => {
  const hook = renderHook(() => usePendingInvitation());
  await act(async () => openPendingInvitation(await invitationURL(code)));
  act(() => hook.result.current.setOpened(true));
  const finishOld = hook.result.current.clear;
  await act(async () => openPendingInvitation(await invitationURL('cd'.repeat(16))));
  act(() => finishOld(true));
  expect(hook.result.current.pending).toMatchObject({ code: 'cd'.repeat(16), opened: false });
  act(() => {
    sessionStorage.setItem(INVITATION_STORAGE_KEY, JSON.stringify({ code, opened: true, receivedAt: Date.now() - 8 * 86400_000 }));
    window.dispatchEvent(new Event('storage'));
  });
  expect(hook.result.current.pending?.code).toBeNull();
  act(() => hook.result.current.clear());
  expect(location.pathname).toBe('/');
  expect(hook.result.current.pending).toBeNull();
});
it('does not restore the previous valid invitation after receiving a malformed replacement', async () => {
  openPendingInvitation(await invitationURL(code));
  history.replaceState(null, '', '/invite#invalid');
  const hook = renderHook(() => usePendingInvitation());
  expect(hook.result.current.pending?.code).toBeNull();
  expect(sessionStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
});
