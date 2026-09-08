import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FriendsActivityProvider, useFriendsActivity } from './FriendsActivity';
import { Friends } from './Friends';
import type { FriendsClient } from '../lib/friends';

const id = '11111111-1111-4111-8111-111111111111';
const friend = { id, nickname: 'Alex', stats: null, arrivedThisWeek: null };
const snapshot = { profile: { nickname: 'Paul', shareStats: true, shareArrival: false }, ownCard: null, friends: [friend] };
const client: FriendsClient = { load: vi.fn().mockResolvedValue(snapshot), action: vi.fn() };
const auth = { userId: 'sender', getAccessToken: vi.fn().mockResolvedValue('fixture') };
function Harness({ paused = false }: { paused?: boolean }) {
  return <FriendsActivityProvider auth={auth} paused={paused}><Friends client={client} parcels={[]} demo={false} /></FriendsActivityProvider>;
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === 'POST' ? { snapshot } : { updates: [{ friendId: id, nickname: 'Alex' }] }))));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });
it('opens a sender notice on the friend’s card and acknowledges it once', async () => {
  const user = userEvent.setup(); render(<Harness />);
  const notice = await screen.findByRole('button', { name: 'Alex accepted your invitation' });
  await user.click(notice);
  expect(location.search).toBe(`?view=friends&friend=${id}`);
  await waitFor(() => expect(document.querySelector('[data-arriving="landed"]')).toHaveTextContent('Alex'));
  expect(screen.queryByRole('button', { name: 'Alex accepted your invitation' })).toBeNull();
  expect(vi.mocked(fetch).mock.calls.filter(([, options]) => (options as RequestInit)?.method === 'POST').every(([, options]) => JSON.parse(String((options as RequestInit).body)).action === 'acknowledge_friend')).toBe(true);
});
it('dismisses a notice without navigating and keeps it quiet through polling', async () => {
  const user = userEvent.setup(); render(<Harness />);
  await user.click(await screen.findByRole('button', { name: 'Dismiss notification' }));
  expect(location.search).toBe('');
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(screen.queryByText('Alex accepted your invitation')).toBeNull();
});
it('clears private notices on background and defers them during another invitation', async () => {
  const view = render(<Harness paused />);
  expect(fetch).not.toHaveBeenCalled();
  view.rerender(<Harness />);
  expect(await screen.findByText('Alex accepted your invitation')).toBeVisible();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => fireEvent(document, new Event('visibilitychange')));
  expect(screen.queryByText('Alex accepted your invitation')).toBeNull();
});
it('uses the acceptance snapshot immediately for the card entrance', async () => {
  function Receive() {
    const activity = useFriendsActivity();
    return <button onClick={() => activity?.prepareArrival(friend, snapshot)}>Receive</button>;
  }
  function ReceiptHarness() {
    const activity = useFriendsActivity();
    return activity?.arrival ? <Friends client={client} parcels={[]} demo={false} /> : <Receive />;
  }
  render(<StrictMode><FriendsActivityProvider auth={auth} paused><ReceiptHarness /></FriendsActivityProvider></StrictMode>);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Receive' }));
  expect(screen.getByText('Alex')).toBeInTheDocument();
  await waitFor(() => expect(document.querySelector('[data-arriving="landed"]')).toHaveTextContent('Alex'));
});
