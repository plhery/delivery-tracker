import { useRef } from 'react';
import { DELIVERED_SCAN, JOURNEY, STILL_SCAN } from './journey';
import { More } from './More';
import { Moves } from './Moves';
import { useJourneyStory } from './useJourneyStory';
import { useLive, useReducedMotion } from './useLive';
import { Who } from './Who';
import './Landing.css';

/**
 * What the landing says below the field, each section a question a visitor
 * asks next: will I know when it moves, why sign in, and who is behind this.
 * The journey plays only while its card is on screen in a tab someone is
 * looking at; a reader who asked for less motion sees its most telling frame.
 */
export function Landing({ onSignIn }: { onSignIn: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  // The story is told on the map: it waits until a good part of the card shows.
  const live = useLive(card, .3);
  const still = useReducedMotion();
  const story = useJourneyStory(JOURNEY.length, live && !still);
  const scan = still ? STILL_SCAN : story;
  return <>
    <Moves scan={scan} card={card} />
    <More onSignIn={onSignIn} landed={scan === DELIVERED_SCAN} />
    <Who />
  </>;
}
