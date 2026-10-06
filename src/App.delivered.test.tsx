import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { throwConfetti } from './lib/deliveredConfetti';
import { ParcelsProvider } from './store/ParcelsContext';
import type { ParcelRepo, ParcelWithEvents, Stage } from './types';

vi.mock('./lib/deliveredConfetti', () => ({ throwConfetti: vi.fn() }));

const HOUR = 3_600_000;
const scan = (parcelId: string, stage: Stage, hoursAgo: number) => ({
  id: `${parcelId}-${stage}`, parcelId, stage, description: stage, occurredAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
});
const parcel = (id: string, label: string, stages: Stage[]): ParcelWithEvents => ({
  id, label, trackingNumber: `99341234561234567${id.length}`, carrier: 'swiss-post', syncStatus: 'ok',
  createdAt: new Date(Date.now() - 80 * HOUR).toISOString(),
  events: stages.map((stage, index) => scan(id, stage, (stages.length - index) * 2)),
});

const onItsWay: Stage[] = ['accepted', 'in_transit', 'out_for_delivery'];
const saved = [parcel('tea', 'Tea', onItsWay), parcel('lamp', 'Lamp', ['accepted', 'in_transit']), parcel('book', 'Book', [...onItsWay, 'delivered'])];
// The lamp moved on in the same answer: on its own, that would make it the next parcel to arrive.
const fresh = [
  parcel('tea', 'Tea', [...onItsWay, 'delivered']),
  { ...parcel('lamp', 'Lamp', onItsWay), expectedDelivery: new Date().toISOString().slice(0, 10) },
  saved[2],
];

/** An account whose saved list still shows the tea on its way, and whose service answers that it was delivered. */
function repo(): ParcelRepo {
  return { mode: 'api', cachedList: () => saved, list: vi.fn().mockResolvedValue(fresh), add: vi.fn(), rename: vi.fn(), remove: vi.fn(), refresh: vi.fn() };
}

function renderApp() {
  return render(<ParcelsProvider repo={repo()}><App /></ParcelsProvider>);
}

const active = () => screen.getByRole('region', { name: 'On the way' });
const past = () => screen.getByRole('region', { name: 'Past deliveries' });
const tea = (region: HTMLElement) => within(region).queryByRole('button', { name: /Tea — / });

describe('a parcel delivered since the list was last shown', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    // A browser that can show the card moving.
    Element.prototype.animate = (() => ({ finished: new Promise(() => undefined), addEventListener() {}, cancel() {}, finish() {} })) as unknown as typeof Element.prototype.animate;
  });

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
    vi.mocked(throwConfetti).mockClear();
  });

  it('turns to Delivered where its card stands, then leaves for the past deliveries', async () => {
    renderApp();
    expect(tea(active())).toHaveAccessibleName(/^Next up: Tea — Out for delivery/);

    await waitFor(() => expect(tea(active())).toHaveAccessibleName(/^Tea — Delivered/));
    const card = tea(active())!.closest<HTMLElement>('.parcel-card-swipe')!;
    expect(card).toHaveAttribute('data-arrived');
    expect(card).toHaveClass('parcel-card-swipe--hero');
    expect(card.querySelector('.parcel-stamp__postmark')).toBeInTheDocument();
    // The list still counts it among the parcels on their way, and the next one waits its turn.
    expect(within(active()).getByText('2')).toBeInTheDocument();
    expect(tea(past())).toBeNull();
    expect(within(active()).getByRole('button', { name: /^Lamp — / })).toBeInTheDocument();
    // Paper is thrown from its card while it stands there, once.
    await waitFor(() => expect(throwConfetti).toHaveBeenCalledWith(document.querySelector('.deliveries-page'), ['tea'], expect.anything()));
    expect(tea(active())).toBeInTheDocument();

    await waitFor(() => expect(tea(past())).toHaveAccessibleName(/^Tea — Delivered/), { timeout: 2500 });
    expect(throwConfetti).toHaveBeenCalledTimes(1);
    expect(tea(active())).toBeNull();
    expect(tea(past())!.closest('.parcel-card-swipe')).not.toHaveAttribute('data-arrived');
    expect(within(active()).getByRole('button', { name: /^Next up: Lamp — / })).toBeInTheDocument();
  });

  it('stays what it is under a finger, and leaves once the finger has lifted', async () => {
    renderApp();
    await waitFor(() => expect(tea(active())).toHaveAccessibleName(/^Tea — Delivered/));
    fireEvent.pointerDown(window);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(tea(active())).toBeInTheDocument();
    fireEvent.pointerUp(window);
    expect(tea(active())).toBeInTheDocument();
    await waitFor(() => expect(tea(past())).toBeInTheDocument());
    expect(tea(active())).toBeNull();
  });

  it('opens when tapped, and takes its new place under its page without more ado', async () => {
    renderApp();
    await waitFor(() => expect(tea(active())).toHaveAccessibleName(/^Tea — Delivered/));
    fireEvent.click(tea(active())!);
    expect(await screen.findByRole('dialog', { name: 'Tea' })).toBeInTheDocument();
    expect(document.querySelector('.parcel-section--past [data-parcel-id="tea"]')).toBeInTheDocument();
    expect(document.querySelector('[data-arrived]')).toBeNull();
    // No paper over the page that has opened.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(throwConfetti).not.toHaveBeenCalled();
  });

  it('jumps there, as before, where nothing can be shown moving', async () => {
    delete (Element.prototype as Partial<Element>).animate;
    renderApp();
    await waitFor(() => expect(tea(past())).toHaveAccessibleName(/^Tea — Delivered/));
    expect(document.querySelector('[data-arrived]')).toBeNull();
    expect(throwConfetti).not.toHaveBeenCalled();
  });

  it('jumps there while its own page covers the list', async () => {
    window.history.replaceState({}, '', '/?parcel=tea');
    renderApp();
    // The list under the page is out of reach, so it is read from the page itself.
    await waitFor(() => expect(document.querySelector('.parcel-section--past [data-parcel-id="tea"]')).toBeInTheDocument());
    expect(document.querySelector('[data-arrived]')).toBeNull();
  });
});
