'use client';

import { useEffect, useRef, useState } from 'react';
import geography from './geography.json';
import { connectionPath, fitJourney, type Point } from './projection';
import type { Coordinate, JourneyStop } from './scenarios';
import styles from './journey.module.css';

const worldLabels: readonly { name: string; coordinate: Coordinate }[] = [
  { name: 'EUROPE', coordinate: [22, 56] },
  { name: 'ASIA', coordinate: [78, 39] },
  { name: 'INDIAN OCEAN', coordinate: [65, -2] },
];
const regionalLabels: readonly { name: string; coordinate: Coordinate }[] = [
  { name: 'SWITZERLAND', coordinate: [8.1, 47.05] },
  { name: 'FRANCE', coordinate: [6.3, 46.3] },
  { name: 'ITALY', coordinate: [9.85, 45.35] },
  { name: 'GERMANY', coordinate: [8.8, 48.6] },
  { name: 'AUSTRIA', coordinate: [11.2, 47.6] },
];
const localLabels: readonly { name: string; coordinate: Coordinate }[] = [
  { name: 'Basel', coordinate: [7.59, 47.56] },
  { name: 'Lucerne', coordinate: [8.31, 47.05] },
  { name: 'Winterthur', coordinate: [8.72, 47.5] },
];

export function JourneyMap({ stops, allStops = stops, selectedId, onSelect, latestHasLocation = true, cover = false }: {
  stops: readonly JourneyStop[];
  allStops?: readonly JourneyStop[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  latestHasLocation?: boolean;
  cover?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 480, height: 240 });
  const hasStops = stops.length > 0;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasStops]);

  if (!stops.length) return <div className={styles.emptyMap}>
    <svg viewBox="0 0 48 48" aria-hidden="true"><path d="m5 12 12-5 14 5 12-5v29l-12 5-14-5-12 5V12Zm12-5v29m14-24v29" /><circle cx="25" cy="23" r="4" /></svg>
    <strong>The journey starts with a scan.</strong>
    <span>A map will appear when the carrier reports a location.</span>
  </div>;

  const { width, height } = size;
  const frame = fitJourney(stops.map(stop => stop.coordinate), width, height, cover ? { top: 118, bottom: 66 } : undefined);
  const points = stops.map(stop => frame.project(stop.coordinate));
  const longDistance = frame.scale < 700;
  const lastId = allStops.at(-1)?.id;
  const labels = longDistance ? worldLabels : frame.scale < 4500 ? regionalLabels : localLabels;
  const inside = ([x, y]: Point, margin = 25) => x > margin && x < width - margin && y > margin && y < height - margin;
  // Dense arrival scans share a marker at atlas scale; their full itinerary stays selectable.
  const priority = [...stops].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId)
    || Number(b.id === lastId) - Number(a.id === lastId));
  const visible: { stop: JourneyStop; point: Point }[] = [];
  for (const stop of priority) {
    const point = frame.project(stop.coordinate);
    if (!visible.some(other => Math.hypot(point[0] - other.point[0], point[1] - other.point[1]) < 42)) visible.push({ stop, point });
  }
  const visitedCountries = new Set(allStops.map(stop => stop.countryCode));

  return <div className={styles.map} ref={container} data-scale={longDistance ? 'world' : frame.scale < 4500 ? 'regional' : 'local'}>
    <svg className={styles.mapDrawing} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <g transform={`translate(${frame.x} ${frame.y}) scale(${frame.scale})`}>
        {geography.countries.map(country => <path key={country.id + country.name} d={country.path}
          className={`${styles.land} ${visitedCountries.has(country.id) ? styles.visitedLand : ''}`}
          vectorEffect="non-scaling-stroke" />)}
        {geography.lakes.map((path, index) => <path key={index} d={path} className={styles.lake} />)}
      </g>
      {labels.map(label => {
        const point = frame.project(label.coordinate);
        const collides = visible.some(stop => Math.hypot(point[0] - stop.point[0], point[1] - stop.point[1]) < 62);
        return inside(point, 40) && !collides ? <text key={label.name} x={point[0]} y={point[1]}
          className={longDistance || frame.scale < 4500 ? styles.countryLabel : styles.cityLabel}>{label.name}</text> : null;
      })}
      {points.slice(1).map((point, index) => <path key={stops[index + 1].id}
        d={connectionPath(points[index], point, longDistance)} className={styles.routeLine} />)}
      {points.map((point, index) => <circle key={stops[index].id} cx={point[0]} cy={point[1]} r="2" className={styles.smallStop} />)}
    </svg>
    {visible.map(({ stop, point }) => {
      const current = stop.id === lastId && latestHasLocation;
      const active = stop.id === selectedId;
      const labelBelow = point[1] < 45;
      const nearbyCount = stops.filter(other => other.id !== stop.id && !visible.some(item => item.stop.id === other.id)
        && Math.hypot(frame.project(other.coordinate)[0] - point[0], frame.project(other.coordinate)[1] - point[1]) < 42).length;
      return <button type="button" key={stop.id} className={styles.mapPin}
        data-active={active} data-current={current} data-label-below={labelBelow}
        aria-label={`${stop.city}, ${stop.country}${current ? ' · Last reported location' : ''}${nearbyCount ? ` · ${nearbyCount} nearby stops` : ''}`}
        aria-pressed={active} onClick={() => onSelect(stop.id)}
        style={{ left: `${point[0] / width * 100}%`, top: `${point[1] / height * 100}%` }}>
        <span className={styles.pinDot} />
        <span className={styles.pinLabel}>{stop.city}</span>
        {nearbyCount > 0 && <span className={styles.pinCount} aria-hidden="true">+{nearbyCount}</span>}
      </button>;
    })}
    <span className={styles.mapCaption}>{stops.length === 1 ? 'LAST KNOWN AREA' : longDistance ? 'ATLAS' : frame.scale < 4500 ? 'REGION' : 'LOCAL'} <span>·</span> Reported stops</span>
  </div>;
}
