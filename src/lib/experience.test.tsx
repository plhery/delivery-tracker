import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackAction } from './analytics';
import { DEMO_PATH, EXPERIENCE_STORAGE_KEY, LANDING_PATH, endSignInStep, isLandingPath, landingAtRoot, useDemoAddress, useEntryExperience } from './experience';

vi.mock('./analytics', () => ({ trackAction: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/'); });
afterEach(() => { history.replaceState(null, '', '/'); });

describe('the entry experience', () => {
  it('remembers the step a visitor is at, and counts entering and leaving the demo', () => {
    const { result } = renderHook(() => useEntryExperience());
    expect(result.current.screen).toBe('welcome');
    act(() => result.current.navigate('sign-in'));
    expect(result.current.screen).toBe('sign-in');
    act(() => result.current.navigate('demo'));
    expect(result.current.screen).toBe('demo');
    expect(localStorage.getItem(EXPERIENCE_STORAGE_KEY)).toBe('demo');
    history.replaceState({ parcelPostDetail: 'abc', kept: 1 }, '', '/?parcel=abc&view=passport&other=1#top');
    act(() => result.current.navigate('welcome'));
    expect(result.current.screen).toBe('welcome');
    expect(location.pathname + location.search + location.hash).toBe('/?other=1#top');
    expect(history.state).toEqual({ kept: 1 });
    expect(vi.mocked(trackAction).mock.calls).toEqual([['demo-start'], ['demo-exit']]);
  });

  it('keeps the sign-in step for its tab, and the demo for the browser', () => {
    const { result } = renderHook(() => useEntryExperience());
    act(() => result.current.navigate('sign-in'));
    expect(sessionStorage.getItem(EXPERIENCE_STORAGE_KEY)).toBe('sign-in');
    expect(localStorage.getItem(EXPERIENCE_STORAGE_KEY)).toBe('welcome');
    // A reload of the tab finds the step again.
    expect(renderHook(() => useEntryExperience()).result.current.screen).toBe('sign-in');
    // The tab is closed: the next visit starts at the front door.
    act(() => { sessionStorage.clear(); window.dispatchEvent(new Event('storage')); });
    expect(result.current.screen).toBe('welcome');
    act(() => result.current.navigate('demo'));
    act(() => { sessionStorage.clear(); window.dispatchEvent(new Event('storage')); });
    expect(result.current.screen).toBe('demo');
  });

  it('opens the front door in a browser that an earlier version left at the sign-in step', () => {
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'sign-in');
    expect(renderHook(() => useEntryExperience()).result.current.screen).toBe('welcome');
  });

  it('ends the sign-in step once someone is signed in', () => {
    const { result } = renderHook(() => useEntryExperience());
    act(() => result.current.navigate('sign-in'));
    act(() => endSignInStep());
    expect(result.current.screen).toBe('welcome');
    expect(sessionStorage.getItem(EXPERIENCE_STORAGE_KEY)).toBeNull();
    // The demo another tab opened meanwhile stays open.
    act(() => result.current.navigate('demo'));
    act(() => endSignInStep());
    expect(result.current.screen).toBe('demo');
  });

  it('shows the demo at its own address, whatever this browser remembers', () => {
    sessionStorage.setItem(EXPERIENCE_STORAGE_KEY, 'sign-in');
    history.replaceState(null, '', DEMO_PATH);
    const { result } = renderHook(() => ({ experience: useEntryExperience(true), demoAddress: useDemoAddress(true) }));
    expect(result.current.experience.screen).toBe('demo');
    expect(result.current.demoAddress).toBe(true);
    // The address is the demo: nothing is remembered for `/`.
    expect(sessionStorage.getItem(EXPERIENCE_STORAGE_KEY)).toBe('sign-in');
    expect(localStorage.getItem(EXPERIENCE_STORAGE_KEY)).toBeNull();
  });

  it('shows the landing at its own address, whatever this browser remembers, and opens every other step at `/`', () => {
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'demo');
    history.replaceState(null, '', LANDING_PATH);
    const { result } = renderHook(() => useEntryExperience());
    expect(result.current.screen).toBe('welcome');
    // Signing in happens at `/`, where a sign-in provider returns to. Back is the landing again.
    const length = history.length;
    act(() => result.current.navigate('sign-in'));
    expect(location.pathname).toBe('/');
    expect(history.length).toBe(length + 1);
    expect(result.current.screen).toBe('sign-in');
    act(() => { history.replaceState(null, '', LANDING_PATH); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(result.current.screen).toBe('welcome');
    // Staying at the landing is no step to take.
    act(() => result.current.navigate('welcome'));
    expect(location.pathname).toBe(LANDING_PATH);
  });

  it('shows the landing at a language’s address as at its own, and opens every other step at `/`', () => {
    for (const path of ['/home', '/de', '/fr', '/it', '/es', '/pt', '/pl']) expect(isLandingPath(path), path).toBe(true);
    for (const path of ['/', '/en', '/demo', '/sample', '/de/more', '/xx']) expect(isLandingPath(path), path).toBe(false);
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'demo');
    history.replaceState(null, '', '/de');
    const { result } = renderHook(() => useEntryExperience());
    expect(result.current.screen).toBe('welcome');
    act(() => result.current.navigate('sign-in'));
    expect(location.pathname).toBe('/');
    expect(result.current.screen).toBe('sign-in');
  });

  it('tells whether `/` is the landing for a visitor: not while the demo or the sign-in step is open', () => {
    expect(landingAtRoot()).toBe(true);
    // The address the browser is at changes nothing of what `/` shows.
    history.replaceState(null, '', '/de');
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'demo');
    expect(landingAtRoot()).toBe(false);
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'welcome');
    expect(landingAtRoot()).toBe(true);
    sessionStorage.setItem(EXPERIENCE_STORAGE_KEY, 'sign-in');
    expect(landingAtRoot()).toBe(false);
  });

  it('leaves the demo’s address for `/` when the demo is left', () => {
    history.replaceState(null, '', '/demo?parcel=abc&view=friends');
    const { result } = renderHook(() => ({ experience: useEntryExperience(true), demoAddress: useDemoAddress(true) }));
    act(() => result.current.experience.navigate('welcome'));
    expect(location.pathname + location.search).toBe('/');
    expect(result.current.experience.screen).toBe('welcome');
    expect(result.current.demoAddress).toBe(false);
    expect(localStorage.getItem(EXPERIENCE_STORAGE_KEY)).toBe('welcome');
  });

  it('follows Back and Forward between the demo’s address and the rest of the app', () => {
    const { result } = renderHook(() => ({ experience: useEntryExperience(), demoAddress: useDemoAddress() }));
    expect(result.current.demoAddress).toBe(false);
    act(() => { history.replaceState(null, '', DEMO_PATH); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(result.current.demoAddress).toBe(true);
    expect(result.current.experience.screen).toBe('demo');
    act(() => { history.replaceState(null, '', '/demo/more'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(result.current.demoAddress).toBe(false);
  });

  it('counts an arrival at the demo’s address as a demo start once per tab, until the demo is left', () => {
    history.replaceState(null, '', DEMO_PATH);
    const first = renderHook(() => ({ experience: useEntryExperience(true), demoAddress: useDemoAddress(true) }));
    expect(vi.mocked(trackAction).mock.calls).toEqual([['demo-start']]);
    first.unmount();
    // A reload of the same tab is the same visit.
    const second = renderHook(() => ({ experience: useEntryExperience(true), demoAddress: useDemoAddress(true) }));
    expect(vi.mocked(trackAction)).toHaveBeenCalledTimes(1);
    act(() => second.result.current.experience.navigate('welcome'));
    expect(vi.mocked(trackAction).mock.calls).toEqual([['demo-start'], ['demo-exit']]);
    second.unmount();
    history.replaceState(null, '', DEMO_PATH);
    renderHook(() => useDemoAddress(true));
    expect(vi.mocked(trackAction).mock.calls).toEqual([['demo-start'], ['demo-exit'], ['demo-start']]);
  });

  it('renders the demo on the server for its address, and the front door’s step anywhere else', () => {
    function Probe({ demoRoute }: { demoRoute?: boolean }) {
      return <>{useEntryExperience(demoRoute).screen}:{String(useDemoAddress(demoRoute))}</>;
    }
    expect(renderToString(<Probe demoRoute />)).toContain('demo<!-- -->:<!-- -->true');
    expect(renderToString(<Probe />)).toContain('welcome<!-- -->:<!-- -->false');
  });
});
