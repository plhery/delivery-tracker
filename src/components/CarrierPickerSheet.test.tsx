import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { CarrierPickerSheet, type CarrierPickerSection } from './CarrierPickerSheet';

const sections: CarrierPickerSection[] = [
  { key: 'fits', title: 'Fits this number', carriers: ['dpd', 'ciblex'] },
  { key: 'used', title: 'You’ve used', carriers: ['swiss-post'] },
];
const auto = { description: 'Checking which carrier has this parcel…', recommended: true, busy: true };

function renderPicker(props: Partial<Parameters<typeof CarrierPickerSheet>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const view = render(<CarrierPickerSheet selected="auto" auto={auto} sections={sections} onSelect={onSelect} onClose={onClose} {...props} />);
  const picker = screen.getByRole('dialog', { name: 'Carrier' });
  return { ...view, picker, onSelect, onClose, search: within(picker).getByRole('combobox', { name: 'Search carriers' }) };
}

afterEach(() => vi.restoreAllMocks());

describe('carrier picker', () => {
  it('leads with automatic detection, then the sections, then every carrier from A to Z', () => {
    const { picker } = renderPicker();
    const list = within(picker).getByRole('listbox', { name: 'Carrier' });
    const auto = within(list).getAllByRole('option')[0];
    expect(auto).toHaveAccessibleName(/^Detect automatically/);
    expect(auto).toHaveAttribute('aria-selected', 'true');
    expect(auto).toHaveTextContent('Recommended');
    expect(within(within(list).getByRole('group', { name: 'Fits this number' })).getAllByRole('option').map((option) => option.id.split('-').at(-1)))
      .toEqual(['dpd', 'ciblex']);
    const all = within(list).getByRole('group', { name: 'All carriers' });
    expect(within(all).getAllByRole('option').length).toBeGreaterThan(100);
    expect(within(all).getByRole('option', { name: 'Swiss Post' })).toHaveAccessibleDescription('Switzerland · Liechtenstein');
    expect(within(picker).getByRole('navigation', { name: 'Jump to a letter' })).toHaveTextContent(/^AB.*#$/);
  });

  it('starts in the search field and picks with the keyboard', async () => {
    const user = userEvent.setup();
    const { search, onSelect } = renderPicker();
    expect(search).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(search).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-fits-dpd$/));
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('dpd');
  });

  it('searches names, other names and countries, and says when nothing matches', async () => {
    const user = userEvent.setup();
    const { picker, search, onSelect } = renderPicker();
    await user.type(search, 'hugger');
    const [cargo] = within(picker).getAllByRole('option');
    expect(cargo).toHaveAccessibleName('Swiss Post Cargo');
    expect(cargo).toHaveAccessibleDescription('Also called Hugger');
    expect(within(picker).queryByRole('group')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('swiss-post-cargo');

    await user.clear(search);
    await user.type(search, 'zzqx');
    expect(within(picker).queryAllByRole('option')).toEqual([]);
    expect(within(picker).getByRole('status')).toHaveTextContent('No carrier matches “zzqx”.');
  });

  it('keeps its order when an answer arrives, and only adds tags', () => {
    const { picker, rerender, onSelect, onClose } = renderPicker({ tags: { dpd: { label: 'Asking…', tone: 'quiet' }, ciblex: { label: 'Asking…', tone: 'quiet' } } });
    const dpd = within(within(picker).getByRole('group', { name: 'Fits this number' })).getByRole('option', { name: 'DPD' });
    expect(dpd).toHaveAccessibleDescription('Switzerland, Asking…');
    rerender(<CarrierPickerSheet
      selected="auto"
      auto={{ description: 'DPD has this parcel.', recommended: true, busy: false }}
      sections={[{ key: 'known', title: 'Know this number', carriers: ['ciblex'] }, ...sections]}
      tags={{ dpd: { label: 'Has this parcel', tone: 'found' } }}
      onSelect={onSelect}
      onClose={onClose}
    />);
    expect(within(picker).queryByRole('group', { name: 'Know this number' })).not.toBeInTheDocument();
    expect(within(picker).getByRole('group', { name: 'Fits this number' })).toBeInTheDocument();
    expect(within(picker).getAllByRole('option')[0]).toHaveTextContent('DPD has this parcel.');
    expect(dpd).toHaveAccessibleDescription('Switzerland, Has this parcel');
  });

  it('offers no automatic row when choosing a carrier for a saved parcel', async () => {
    const user = userEvent.setup();
    const { picker, onSelect, onClose } = renderPicker({ selected: 'dhl', auto: undefined });
    expect(within(picker).queryByRole('option', { name: /^Detect automatically/ })).not.toBeInTheDocument();
    expect(within(within(picker).getByRole('group', { name: 'All carriers' })).getByRole('option', { name: 'DHL' }))
      .toHaveAttribute('aria-selected', 'true');
    await user.click(within(within(picker).getByRole('group', { name: 'Fits this number' })).getByRole('option', { name: 'Ciblex' }));
    expect(onSelect).toHaveBeenCalledWith('ciblex');
    await user.click(within(picker).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('jumps to a letter as soon as the rail is pressed, and follows a finger sliding along it', () => {
    const { picker } = renderPicker();
    const rail = within(picker).getByRole('navigation', { name: 'Jump to a letter' });
    const letters = within(rail).getAllByRole('button').map((button) => button.textContent);
    // jsdom has no layout: give each letter a 16 px band, top to bottom.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = letters.indexOf(this.dataset.letter ?? '');
      return { top: 100 + index * 16, bottom: 116 + index * 16, left: 0, right: 22, width: 22, height: 16, x: 0, y: 100 + index * 16, toJSON: () => ({}) } as DOMRect;
    });
    const jumped: string[] = [];
    const scrollIntoView = Element.prototype.scrollIntoView;
    onTestFinished(() => { Element.prototype.scrollIntoView = scrollIntoView; });
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) { jumped.push((this as HTMLElement).dataset.letter ?? ''); });
    const at = (letter: string) => 108 + letters.indexOf(letter) * 16;

    fireEvent.pointerDown(rail, { pointerId: 1, pointerType: 'touch', clientY: at('C') });
    // The press alone jumps, before any release.
    expect(jumped).toEqual(['C']);
    expect(within(rail).getByRole('button', { name: 'C' })).toHaveClass('is-current');
    expect(rail.querySelector('.carrier-picker__bubble')).toHaveTextContent('C');

    fireEvent.pointerMove(rail, { pointerId: 1, pointerType: 'touch', clientY: at('C') + 3 });
    fireEvent.pointerMove(rail, { pointerId: 1, pointerType: 'touch', clientY: at('D') });
    fireEvent.pointerMove(rail, { pointerId: 1, pointerType: 'touch', clientY: at('P') });
    // Past the end the last letter holds.
    fireEvent.pointerMove(rail, { pointerId: 1, pointerType: 'touch', clientY: 2000 });
    expect(jumped).toEqual(['C', 'D', 'P', '#']);

    fireEvent.pointerUp(rail, { pointerId: 1, pointerType: 'touch', clientY: 2000 });
    expect(rail.querySelector('.carrier-picker__bubble')).not.toBeInTheDocument();
    fireEvent.pointerMove(rail, { pointerId: 1, pointerType: 'mouse', clientY: at('A') });
    expect(jumped).toEqual(['C', 'D', 'P', '#']);
  });
});
