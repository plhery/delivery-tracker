'use client';

import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { carrierInfo } from '../../lib/carriers';
import { HeroCard, History, ModeToggle, NavBar, RouteSummary, Stats, TrackingNumber, type Snapshot } from './parts';
import { hasNearView, type MapMode } from './route';
import { WorldMap } from './WorldMap';
import styles from './study.module.css';

export type Device = 'phone' | 'desktop';
export type Theme = 'light' | 'dark';

interface DirectionProps {
  parcel: Snapshot;
  device: Device;
  theme: Theme;
  mode: MapMode;
  onMode: (mode: MapMode) => void;
}

/** Pressing the view you are already in brings a dragged map back to the parcel. */
function useCamera(mode: MapMode, onMode: (mode: MapMode) => void) {
  const [free, setFree] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const change = (next: MapMode) => {
    if (next === mode) setRecenter(count => count + 1);
    onMode(next);
  };
  return { free, setFree, recenter, change };
}

function EmptyNote({ parcel }: { parcel: Snapshot }) {
  return <p className={styles.emptyNote}>
    <strong>No places yet.</strong> {carrierInfo(parcel.journey.carrier).name} hasn’t shared where the parcel is. The map fills in with the first place.
  </p>;
}

/** 01. Flighty's own layout: the map is the page, the parcel is a sheet over it. */
export function Deck({ parcel, device, theme, mode, onMode }: DirectionProps) {
  const camera = useCamera(mode, onMode);
  const phone = device === 'phone';
  const empty = parcel.route.scale === 'none';
  const toggle = hasNearView(parcel.route) || camera.free
    ? <ModeToggle mode={mode} onChange={camera.change} free={camera.free} /> : null;
  const map = <WorldMap route={parcel.route} mode={mode} time={parcel.now} night interactive={!empty} redrawKey={theme}
    insets={phone ? { top: 64, right: 0, bottom: 44, left: 0 } : { top: 24, right: 24, bottom: 24, left: 460 }}
    recenter={camera.recenter} onFreeChange={camera.setFree} className={styles.deckMap} labels={empty ? 'none' : 'all'} />;
  const sheet = <>
    <HeroCard parcel={parcel} compact />
    {empty ? <EmptyNote parcel={parcel} /> : <RouteSummary parcel={parcel} />}
    <History parcel={parcel} />
  </>;
  if (phone) return <div className={styles.deck} data-device="phone" data-empty={empty || undefined}>
    <div className={styles.deckStage}>
      {map}
      <NavBar floating />
      <div className={styles.deckControls}>{toggle}</div>
    </div>
    <div className={styles.deckSheet}><span className={styles.grabber} aria-hidden="true" />{sheet}</div>
  </div>;
  return <div className={styles.deck} data-device="desktop" data-empty={empty || undefined}>
    {map}
    <aside className={styles.deckPanel}><NavBar />{sheet}</aside>
    <div className={styles.deckControls}>{toggle}</div>
  </div>;
}

/** 02. The quietest change: the route is engraved in the parcel's own card. */
export function Card({ parcel, device, theme, mode, onMode }: DirectionProps) {
  const [open, setOpen] = useState(false);
  const camera = useCamera(mode, onMode);
  const empty = parcel.route.scale === 'none';
  // The band is a large tap target; the globe button beside the bell is its accessible twin.
  const engraving = empty ? undefined : <div className={styles.cardMap} onClick={() => setOpen(true)} aria-hidden="true">
    <WorldMap route={parcel.route} mode={mode} time={parcel.now} look="tint" labels="ends" context={false} redrawKey={theme}
      insets={{ top: 40, right: 16, bottom: 10, left: 16 }} className={styles.cardMapDrawing} />
  </div>;
  const opener = empty ? undefined : <button type="button" className={styles.heroAction} onClick={() => setOpen(true)} aria-label="Open the map">
    <Icon name="globe" />
  </button>;
  return <div className={styles.page} data-device={device}>
    <div className={styles.pagePanel}>
      <NavBar />
      <HeroCard parcel={parcel} map={engraving} action={opener} />
      <TrackingNumber />
      <History parcel={parcel} legs={false} />
    </div>
    {open && <div className={styles.mapSheet} data-device={device}>
      <WorldMap route={parcel.route} mode={mode} time={parcel.now} night interactive redrawKey={theme}
        insets={device === 'phone' ? { top: 64, right: 0, bottom: 250, left: 0 } : { top: 24, right: 24, bottom: 24, left: 420 }}
        recenter={camera.recenter} onFreeChange={camera.setFree} className={styles.mapSheetMap} />
      <button type="button" className={styles.mapSheetClose} onClick={() => setOpen(false)} aria-label="Close the map"><Icon name="close" /></button>
      <div className={styles.mapSheetBar}>
        <RouteSummary parcel={parcel} />
        {(hasNearView(parcel.route) || camera.free) && <ModeToggle mode={mode} onChange={camera.change} free={camera.free} />}
      </div>
    </div>}
  </div>;
}

/** 03. A small globe with the story told around it; up close it becomes a lens. */
export function Lens({ parcel, device, theme, mode, onMode }: DirectionProps) {
  const camera = useCamera(mode, onMode);
  const empty = parcel.route.scale === 'none';
  return <div className={styles.page} data-device={device}>
    <div className={styles.pagePanel}>
      <NavBar />
      <HeroCard parcel={parcel} />
      <section className={styles.lens} data-empty={empty || undefined}>
        <WorldMap route={parcel.route} mode={mode} time={parcel.now} shape="circle" night interactive={!empty} labels={empty ? 'none' : 'ends'}
          redrawKey={theme} insets={{ top: 22, right: 0, bottom: 22, left: 0 }}
          recenter={camera.recenter} onFreeChange={camera.setFree} className={styles.lensMap} />
        <div className={styles.lensStory}>
          {empty ? <EmptyNote parcel={parcel} /> : <Stats parcel={parcel} />}
          {(hasNearView(parcel.route) || camera.free) && <ModeToggle mode={mode} onChange={camera.change} free={camera.free} compact />}
        </div>
      </section>
      <History parcel={parcel} />
    </div>
  </div>;
}
