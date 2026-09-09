import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider, APPEARANCE_STORAGE_KEY, useAppearance } from './appearance';
import { APPEARANCE_BOOTSTRAP } from './appearanceConfig';

let dark = false;
const changes = new Set<() => void>();
function Controls() {
  const [value, set] = useAppearance();
  return <><output>{value}</output>{(['system', 'light', 'dark'] as const).map((choice) => <button key={choice} onClick={() => set(choice)}>{choice}</button>)}</>;
}
beforeEach(() => {
  window.localStorage.clear();
  window.dispatchEvent(new Event('storage'));
  dark = false;
  changes.clear();
  vi.stubGlobal('matchMedia', () => ({ get matches() { return dark; }, addEventListener: (_: string, listener: () => void) => changes.add(listener), removeEventListener: (_: string, listener: () => void) => changes.delete(listener) }));
  document.head.innerHTML = '<meta name="theme-color" content="#F4F5F1">';
});

describe('appearance', () => {
  it('defaults to light on a dark device, before and after React renders', () => {
    dark = true;
    window.eval(APPEARANCE_BOOTSTRAP);
    expect(document.documentElement.dataset.appearance).toBe('light');
    render(<AppearanceProvider><Controls /></AppearanceProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('light');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#F4F5F1');
  });
  it.each(['light', 'dark', 'system'])('preserves an explicitly saved %s choice', (choice) => {
    dark = true;
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, choice);
    window.eval(APPEARANCE_BOOTSTRAP);
    expect(document.documentElement.dataset.appearance).toBe(choice);
    render(<AppearanceProvider><Controls /></AppearanceProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(choice);
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', choice === 'light' ? '#F4F5F1' : '#151915');
  });
  it('defaults to light when a stored value is invalid or storage cannot be read', () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'invalid');
    window.eval(APPEARANCE_BOOTSTRAP);
    expect(document.documentElement.dataset.appearance).toBe('light');
    const read = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    window.eval(APPEARANCE_BOOTSTRAP);
    expect(document.documentElement.dataset.appearance).toBe('light');
    render(<AppearanceProvider><Controls /></AppearanceProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('light');
    read.mockRestore();
  });

  it('returns an open screen from forced dark to the light system immediately', () => {
    render(<AppearanceProvider><Controls /></AppearanceProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(document.documentElement.dataset.appearance).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#151915');
    fireEvent.click(screen.getByRole('button', { name: 'system' }));
    expect(document.documentElement.dataset.appearance).toBe('system');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#F4F5F1');
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('system');
  });
  it('follows system changes only while system is selected', () => {
    render(<AppearanceProvider><Controls /></AppearanceProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'system' }));
    act(() => { dark = true; changes.forEach((listener) => listener()); });
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#151915');
    fireEvent.click(screen.getByRole('button', { name: 'light' }));
    act(() => { changes.forEach((listener) => listener()); });
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#F4F5F1');
  });
  it('applies saved appearance before React renders and accepts cross-tab changes', () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'dark');
    window.eval(APPEARANCE_BOOTSTRAP);
    expect(document.documentElement.dataset.appearance).toBe('dark');
    render(<AppearanceProvider><Controls /></AppearanceProvider>);
    act(() => { window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'light'); window.dispatchEvent(new Event('storage')); });
    expect(document.documentElement.dataset.appearance).toBe('light');
  });
  it('remains usable when persistence is unavailable', () => {
    const save = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    render(<AppearanceProvider><Controls /></AppearanceProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(screen.getByRole('status')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.appearance).toBe('dark');
    save.mockRestore();
  });
});
