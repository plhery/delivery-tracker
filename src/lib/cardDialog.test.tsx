import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCardDialog } from './cardDialog';

function Page({ onClose, card }: { onClose: () => void; card: () => HTMLElement | null }) {
  const [dialog, close] = useCardDialog<HTMLDivElement>(onClose, undefined, { findCard: card });
  return <div ref={dialog} role="dialog" aria-label="A parcel" tabIndex={-1}>
    <button type="button" onClick={close}>Back</button>
    <input aria-label="Name" data-escape="own" />
    <input aria-label="Note" />
  </div>;
}

describe('useCardDialog', () => {
  it('takes the focus, closes at once where nothing can move, and hands the focus back to the card', () => {
    const onClose = vi.fn();
    const view = render(<><div className="door"><button type="button">Card</button></div></>);
    const card = screen.getByRole('button', { name: 'Card' });
    card.focus();
    view.rerender(<><div className="door"><button type="button">Card</button></div><Page onClose={onClose} card={() => null} /></>);
    expect(screen.getByRole('dialog', { name: 'A parcel' })).toHaveFocus();
    // The surface behind the page is out of reach while it is open.
    expect(document.querySelector('.door')).toHaveAttribute('inert');
    screen.getByRole('button', { name: 'Back' }).click();
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(<><div className="door"><button type="button">Card</button></div></>);
    expect(document.querySelector('.door')).not.toHaveAttribute('inert');
    expect(card).toHaveFocus();
  });

  it('closes on Escape, except from a field that cancels its own edit with it', () => {
    const onClose = vi.fn();
    render(<Page onClose={onClose} card={() => null} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('gives the focus to the card that stands there now, when the one that opened the page was drawn anew', () => {
    const view = render(<div className="door"><button type="button" key="old">Card</button></div>);
    screen.getByRole('button', { name: 'Card' }).focus();
    const find = () => document.querySelector<HTMLElement>('.door button');
    view.rerender(<><div className="door"><button type="button" key="new">Card</button></div><Page onClose={() => undefined} card={find} /></>);
    view.rerender(<div className="door"><button type="button" key="new">Card</button></div>);
    expect(find()).toHaveFocus();
  });
});
