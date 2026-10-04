import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { laterCode, type LaterCode } from './laterCode';

interface Screens { name: string }
/** Other work on the machine can hold a test back; what is waited for here comes in a moment otherwise. */
const WAIT = { timeout: 10_000 };

function Reader({ code, wanted, giveUp }: { code: LaterCode<Screens>; wanted: boolean; giveUp?: () => void }) {
  return <p>{code.useCode(wanted, giveUp)?.name ?? 'waiting'}</p>;
}

const mounted = vi.fn();
/** A page that says when it has come alive. */
function Early({ code }: { code: LaterCode<Screens> }) {
  code.useEarly();
  useEffect(() => { mounted(code.read()?.name); }, [code]);
  return <p>the page</p>;
}

/** A fetch the test answers by hand. */
function deferred() {
  const calls: { resolve: (screens: Screens) => void; reject: (error: Error) => void }[] = [];
  const fetchCode = vi.fn(() => new Promise<Screens>((resolve, reject) => { calls.push({ resolve, reject }); }));
  return { fetchCode, calls };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mounted.mockClear(); sessionStorage.clear(); });

describe('laterCode', () => {
  it('fetches nothing until a screen wants the code, then fetches it once for every reader', async () => {
    const { fetchCode, calls } = deferred();
    const code = laterCode(fetchCode, () => false);
    const view = render(<><Reader code={code} wanted={false} /><Reader code={code} wanted={false} /></>);
    expect(fetchCode).not.toHaveBeenCalled();
    expect(screen.getAllByText('waiting')).toHaveLength(2);

    view.rerender(<><Reader code={code} wanted /><Reader code={code} wanted /></>);
    expect(fetchCode).toHaveBeenCalledOnce();
    await act(async () => { calls[0].resolve({ name: 'deliveries' }); });
    expect(screen.getAllByText('deliveries')).toHaveLength(2);
    expect(code.read()).toEqual({ name: 'deliveries' });
    await code.load();
    expect(fetchCode).toHaveBeenCalledOnce();
  });

  it('draws at once with code a page brought along', async () => {
    const { fetchCode } = deferred();
    const code = laterCode(fetchCode, () => false);
    code.provide({ name: 'brought along' });
    render(<Reader code={code} wanted />);
    expect(screen.getByText('brought along')).toBeVisible();
    await code.load();
    expect(fetchCode).not.toHaveBeenCalled();
  });

  it('asks again after a failed fetch, and gives up when it keeps failing', async () => {
    vi.useFakeTimers();
    const { fetchCode, calls } = deferred();
    const giveUp = vi.fn();
    const code = laterCode(fetchCode, () => false);
    render(<Reader code={code} wanted giveUp={giveUp} />);
    await act(async () => { calls[0].reject(new Error('gone')); });
    expect(fetchCode).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchCode).toHaveBeenCalledTimes(2);
    await act(async () => { calls[1].reject(new Error('gone')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchCode).toHaveBeenCalledTimes(3);
    expect(giveUp).not.toHaveBeenCalled();
    await act(async () => { calls[2].reject(new Error('gone')); });
    expect(giveUp).toHaveBeenCalledOnce();
    expect(screen.getByText('waiting')).toBeVisible();
  });

  it('waits for the connection instead of counting failures while offline, and asks when it is back', async () => {
    const { fetchCode, calls } = deferred();
    const giveUp = vi.fn();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const code = laterCode(fetchCode, () => false);
    render(<Reader code={code} wanted giveUp={giveUp} />);
    await act(async () => { calls[0].reject(new Error('offline')); });
    expect(fetchCode).toHaveBeenCalledTimes(1);

    online.mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(fetchCode).toHaveBeenCalledTimes(2);
    await act(async () => { calls[1].resolve({ name: 'back online' }); });
    expect(screen.getByText('back online')).toBeVisible();
    expect(giveUp).not.toHaveBeenCalled();
  });

  it('stops asking once nothing wants the code any more', async () => {
    vi.useFakeTimers();
    const { fetchCode, calls } = deferred();
    const code = laterCode(fetchCode, () => false);
    const view = render(<Reader code={code} wanted giveUp={() => undefined} />);
    view.unmount();
    await act(async () => { calls[0].reject(new Error('gone')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchCode).toHaveBeenCalledTimes(1);
  });

  /** The page as the server drew it, coming alive in the browser. */
  async function arrive(code: LaterCode<Screens>) {
    const container = document.createElement('div');
    container.innerHTML = '<p>the page</p>';
    document.body.append(container);
    let root!: Root;
    await act(async () => { root = hydrateRoot(container, <Early code={code} />); });
    return { container, leave: () => act(async () => { root.unmount(); container.remove(); }) };
  }

  it('asks at the start where the browser will open on these screens, and holds the page until the code is here', async () => {
    const { fetchCode, calls } = deferred();
    const code = laterCode(fetchCode, () => true);
    expect(fetchCode).toHaveBeenCalledOnce();
    const { container, leave } = await arrive(code);
    // What the server drew stands in place, and nothing has run yet.
    expect(container).toHaveTextContent('the page');
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => { calls[0].resolve({ name: 'deliveries' }); });
    await waitFor(() => expect(mounted).toHaveBeenCalledExactlyOnceWith('deliveries'), WAIT);
    await leave();
  });

  it('comes alive without code that could not be fetched at the start', async () => {
    const { fetchCode, calls } = deferred();
    const code = laterCode(fetchCode, () => true);
    const { container, leave } = await arrive(code);
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => { calls[0].reject(new Error('gone')); });
    await waitFor(() => expect(mounted).toHaveBeenCalledExactlyOnceWith(undefined), WAIT);
    expect(container).toHaveTextContent('the page');
    await leave();
  });

  it('never holds back a page that does not open on these screens', async () => {
    const { fetchCode } = deferred();
    const code = laterCode(fetchCode, () => false);
    const { leave } = await arrive(code);
    expect(mounted).toHaveBeenCalledOnce();
    expect(fetchCode).not.toHaveBeenCalled();
    await leave();
  });

  it('never holds back a page that is already alive', () => {
    const { fetchCode } = deferred();
    const code = laterCode(fetchCode, () => true);
    render(<Early code={code} />);
    expect(screen.getByText('the page')).toBeVisible();
    expect(mounted).toHaveBeenCalledOnce();
  });
});
