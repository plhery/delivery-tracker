import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddParcelSheet } from './AddParcelSheet';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSheet(iPhone: boolean) {
  if (iPhone) vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)');
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: iPhone && query === '(max-width: 760px)' }));
  render(<AddParcelSheet onAdd={vi.fn()} onClose={vi.fn()} initialLabel="Coffee" />);
  return {
    tracking: screen.getByRole<HTMLTextAreaElement>('textbox', { name: /^Tracking number or link/ }),
    name: screen.getByRole<HTMLInputElement>('textbox', { name: /^Name/ }),
  };
}

describe('Add parcel field focus', () => {
  it('refocuses iPhone fields without letting Safari scroll the page behind the sheet', () => {
    const { tracking, name } = renderSheet(true);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');

    name.setSelectionRange(1, 4);
    name.focus();

    expect(name).toHaveFocus();
    expect(focus.mock.contexts).toEqual([name, tracking, name]);
    expect(focus.mock.calls.slice(1)).toEqual([[{ preventScroll: true }], [{ preventScroll: true }]]);
    expect([name.selectionStart, name.selectionEnd]).toEqual(['Coffee'.length, 'Coffee'.length]);
  });

  it('leaves other browsers to focus fields natively', () => {
    const { name } = renderSheet(false);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');

    name.focus();

    expect(name).toHaveFocus();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
