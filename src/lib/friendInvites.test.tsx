import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { invitationCode, invitationURL, INVITATION_STORAGE_KEY, openPendingInvitation, usePendingInvitation } from './friendInvites';

const code = 'ab'.repeat(16);
afterEach(() => { sessionStorage.clear(); history.replaceState(null, '', '/'); });
it('accepts only complete trusted links and keeps their token out of HTTP requests', () => {
  const url = invitationURL(code);
  expect(invitationCode(url)).toBe(code);
  expect(new URL(url).pathname).toBe('/invite');
  expect(new URL(url).search).toBe('');
  for (const invalid of [code, `https://evil.example/invite#${code}`, `${location.origin}/invite?name=Paul#${code}`, `${location.origin}/invite#short`, url.replace('/invite', '/other'), url.replace('ab', 'AB')]) expect(invitationCode(invalid)).toBeNull();
});
it('strips the fragment, remembers opening through OAuth, and clears after accepting', async () => {
  history.replaceState(null, '', `/invite#${code}`);
  const first = renderHook(() => usePendingInvitation());
  await waitFor(() => expect(location.hash).toBe(''));
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
it('replaces an old invitation, rejects an expired one, and dismisses to the unopened start', () => {
  const hook = renderHook(() => usePendingInvitation());
  act(() => openPendingInvitation(invitationURL(code)));
  act(() => hook.result.current.setOpened(true));
  const finishOld = hook.result.current.clear;
  act(() => openPendingInvitation(invitationURL('cd'.repeat(16))));
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
it('does not restore the previous valid invitation after receiving a malformed replacement', () => {
  openPendingInvitation(invitationURL(code));
  history.replaceState(null, '', '/invite#invalid');
  const hook = renderHook(() => usePendingInvitation());
  expect(hook.result.current.pending?.code).toBeNull();
  expect(sessionStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
});
