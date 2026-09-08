import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SignInScreen } from './SignInScreen';

describe('SignInScreen', () => {
  it('requests and verifies an emailed one-time code', async () => {
    const sendCode = vi.fn().mockResolvedValue(undefined);
    const verifyCode = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <SignInScreen configured sendCode={sendCode} verifyCode={verifyCode} />,
    );

    expect(screen.getByRole('heading', {
      name: 'Your deliveries, together.',
    })).toBeInTheDocument();
    expect(screen.getByText('Sign in to start tracking.'))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the privacy notice.' }))
      .toHaveAttribute('href', '/privacy.html');

    await user.type(screen.getByLabelText('Email address'), 'Owner@Example.Test');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(sendCode).toHaveBeenCalledWith('owner@example.test');

    const code = screen.getByLabelText('Sign-in code');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await user.type(code, '12a 3456');
    await user.click(screen.getByRole('button', { name: "View my parcels" }));
    expect(verifyCode).toHaveBeenCalledWith('owner@example.test', '123456');
  });

  it('keeps provider errors actionable', async () => {
    const sendCode = vi.fn().mockRejectedValue(new Error('Email rate limit reached'));
    const user = userEvent.setup();
    render(
      <SignInScreen configured sendCode={sendCode} verifyCode={vi.fn()} />,
    );
    await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait a moment before trying again.');
  });

  it('supports Google-only production sign-in', async () => {
    const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <SignInScreen
        configured
        googleEnabled
        emailOtpEnabled={false}
        signInWithGoogle={signInWithGoogle}
        sendCode={vi.fn()}
        verifyCode={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('offers Apple alongside Google, prevents duplicate starts, and allows retry after failure', async () => {
    let reject!: (error: Error) => void;
    const signInWithApple = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValue(undefined);
    const signInWithGoogle = vi.fn();
    const user = userEvent.setup();
    render(<SignInScreen configured appleEnabled googleEnabled signInWithApple={signInWithApple}
      signInWithGoogle={signInWithGoogle} sendCode={vi.fn()} verifyCode={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    expect(screen.getByRole('button', { name: 'Opening Apple…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with email' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Opening Apple…' }));
    expect(signInWithApple).toHaveBeenCalledOnce();
    reject(new Error('Provider configuration detail'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t open Apple sign-in. Try again.');
    await user.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    expect(signInWithApple).toHaveBeenCalledTimes(2);
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it('keeps email secondary with Apple as the only social provider', async () => {
    const user = userEvent.setup();
    render(<SignInScreen configured appleEnabled signInWithApple={vi.fn()} sendCode={vi.fn()} verifyCode={vi.fn()} />);
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in with email' }));
    expect(screen.getByLabelText('Email address')).toHaveFocus();
  });

  it('hides Apple until the provider is configured', () => {
    render(<SignInScreen configured signInWithApple={vi.fn()} sendCode={vi.fn()} verifyCode={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).not.toBeInTheDocument();
  });

  it('keeps email secondary until the user asks for it', async () => {
    const user = userEvent.setup();
    render(
      <SignInScreen
        configured
        googleEnabled
        emailOtpEnabled
        signInWithGoogle={vi.fn()}
        sendCode={vi.fn()}
        verifyCode={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in with email' }));
    expect(screen.getByLabelText('Email address')).toHaveFocus();
  });

  it('explains missing deployment configuration', () => {
    render(
      <SignInScreen configured={false} sendCode={vi.fn()} verifyCode={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You can explore the app with demo parcels while sign-in is unavailable.',
    );
  });
});
