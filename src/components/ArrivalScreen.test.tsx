import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArrivalScreen } from './ArrivalScreen';

const signIn = { configured: false, googleEnabled: false, emailOtpEnabled: false, sendCode: async () => undefined, verifyCode: async () => undefined };
const arrival = () => document.querySelector('.arrival')!;

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('ArrivalScreen entered at sign-in', () => {
  it('stands the box closed in its sign-in place, opens it there, then rests', async () => {
    vi.useFakeTimers();
    render(<ArrivalScreen screen="sign-in" onNavigate={vi.fn()} {...signIn} />);
    // The sign-in card is there from the first frame; only the box waits.
    expect(screen.getByRole('heading', { name: 'Sign in' })).toHaveFocus();
    expect(arrival()).toHaveClass('arrival--arriving', 'arrival--onboarding');
    expect(arrival()).not.toHaveClass('arrival--sign-in');
    expect(arrival()).not.toHaveClass('arrival--opening');
    await act(async () => { await vi.advanceTimersToNextFrame(); });
    expect(arrival()).toHaveClass('arrival--sign-in', 'arrival--opening');
    expect(arrival()).not.toHaveClass('arrival--arriving');
    await act(async () => { await vi.advanceTimersByTimeAsync(959); });
    expect(arrival()).toHaveClass('arrival--opening');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(arrival()).toHaveClass('arrival--sign-in');
    expect(arrival()).not.toHaveClass('arrival--opening');
  });

  it('settles at once under reduced motion', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<ArrivalScreen screen="sign-in" onNavigate={vi.fn()} {...signIn} />);
    await act(async () => { await vi.advanceTimersToNextFrame(); });
    expect(arrival()).toHaveClass('arrival--opening');
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    expect(arrival()).not.toHaveClass('arrival--opening');
    expect(arrival()).toHaveClass('arrival--sign-in');
  });

  it('goes back to the front door and into the demo from there', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<ArrivalScreen screen="sign-in" onNavigate={onNavigate} {...signIn} />);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onNavigate).toHaveBeenLastCalledWith('welcome');
    await user.click(screen.getByRole('button', { name: 'Explore the demo' }));
    expect(onNavigate).toHaveBeenLastCalledWith('demo');
  });

  it('leaves an invitation’s own opening as it was', () => {
    render(<ArrivalScreen screen="sign-in" onNavigate={vi.fn()} {...signIn}
      invitation={{ title: 'An invitation', canOpen: true, onDismiss: vi.fn() }} />);
    expect(arrival()).toHaveClass('arrival--sign-in', 'arrival--invitation');
    expect(arrival()).not.toHaveClass('arrival--arriving');
  });
});
