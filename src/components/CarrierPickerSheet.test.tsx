import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
});
