import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiFriendCard, ApiFriendsActivity, ApiFriendsSnapshot, ApiFriendUpdate } from '../generated/apiContract';
import { authenticatedFetch, type ApiAuth } from '../lib/apiClient';
import { useI18n } from '../i18n';
import { Icon, PostageStamp } from './Icon';

export type FriendArrival = { key: number; friendId: string; snapshot?: ApiFriendsSnapshot };
type Activity = {
  arrival: FriendArrival | null;
  prepareArrival: (friend: ApiFriendCard, snapshot?: ApiFriendsSnapshot) => void;
  consumeArrival: (key: number) => void;
  acknowledge: (friendId: string) => Promise<void>;
};
const FriendsActivityContext = createContext<Activity | null>(null);
export const useFriendsActivity = () => useContext(FriendsActivityContext);

export function FriendsActivityProvider({ auth, paused, children }: { auth: ApiAuth; paused: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const [updates, setUpdates] = useState<ApiFriendUpdate[]>([]);
  const [arrival, setArrival] = useState<FriendArrival | null>(null);
  const sequence = useRef(0);
  const dismissed = useRef(new Set<string>());
  useEffect(() => {
    const hide = () => { if (document.hidden) { setUpdates([]); setArrival(null); } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  const prepareArrival = useCallback((friend: ApiFriendCard, snapshot?: ApiFriendsSnapshot) => {
    setArrival({ key: ++sequence.current, friendId: friend.id, snapshot });
  }, []);
  const consumeArrival = useCallback((key: number) => setArrival((current) => current?.key === key ? null : current), []);
  const acknowledge = useCallback(async (friendId: string) => {
    if (dismissed.current.has(friendId)) return;
    dismissed.current.add(friendId); setUpdates((items) => items.filter((item) => item.friendId !== friendId));
    void navigator.serviceWorker?.getRegistration?.().then((registration) => registration?.getNotifications({ tag: `friend-${friendId}` }))
      .then((notifications) => notifications?.forEach((notification) => notification.close())).catch(() => undefined);
    try {
      await authenticatedFetch('/api/friends', auth, { method: 'POST', body: JSON.stringify({ action: 'acknowledge_friend', friendId }) });
    } catch { /* A dismissed notice stays quiet during this visit, including offline. */ }
  }, [auth]);
  useEffect(() => {
    if (paused) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      clearTimeout(timer); controller?.abort(); controller = new AbortController();
      const request = controller;
      if (document.hidden) { setUpdates([]); setArrival(null); return; }
      try {
        const response = await authenticatedFetch('/api/friends/activity', auth, { signal: request.signal });
        if (response.ok) {
          const data = await response.json() as ApiFriendsActivity;
          if (!disposed && !request.signal.aborted && Array.isArray(data.updates)) setUpdates(data.updates.filter((item) => !dismissed.current.has(item.friendId)));
        }
      } catch { /* Polling resumes after transient network failures. */ }
      if (!disposed && !request.signal.aborted) timer = setTimeout(refresh, 30_000);
    }
    void refresh(); document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; controller?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [auth, paused]);
  const value = useMemo(() => ({ arrival, prepareArrival, consumeArrival, acknowledge }), [arrival, prepareArrival, consumeArrival, acknowledge]);
  const update = !paused ? updates[0] : undefined;
  function openUpdate(item: ApiFriendUpdate) {
    setArrival({ key: ++sequence.current, friendId: item.friendId });
    window.history.pushState(window.history.state, '', `/?view=friends&friend=${encodeURIComponent(item.friendId)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    void acknowledge(item.friendId);
  }
  return <FriendsActivityContext.Provider value={value}>
    {children}
    {update && <aside className="friend-accepted-notice" aria-live="polite">
      <button className="friend-accepted-notice__open" onClick={() => openUpdate(update)}>
        <PostageStamp icon="friends" /><span>{t('friends.invitationAccepted', { name: update.nickname })}</span><Icon name="arrow" />
      </button>
      <button className="icon-button" aria-label={t('friends.dismissUpdate')} onClick={() => void acknowledge(update.friendId)}><Icon name="close" /></button>
    </aside>}
  </FriendsActivityContext.Provider>;
}
