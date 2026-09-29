import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** The open carrier picker. */
export function carrierPicker(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Carrier' });
}

/** Opens the carrier picker with `opener`, searches for `name` and picks it. */
export async function pickCarrier(user: UserEvent, opener: HTMLElement, name: string): Promise<void> {
  await user.click(opener);
  const picker = await screen.findByRole('dialog', { name: 'Carrier' });
  await user.type(within(picker).getByRole('combobox', { name: 'Search carriers' }), name);
  await user.click(within(picker).getByRole('option', { name }));
}
