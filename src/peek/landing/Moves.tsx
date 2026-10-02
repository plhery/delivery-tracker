import { lazy, Suspense, type CSSProperties, type RefObject } from 'react';
import { CarrierMark } from '../../components/CarrierMark';
import { Icon } from '../../components/Icon';
import { PeekMark } from '../../components/PeekMark';
import { ProgressTrack } from '../../components/ProgressTrack';
import { useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo } from '../../lib/carriers';
import { JOURNEY, JOURNEY_CARRIER } from './journey';
import { useNear } from './useLive';
import './Moves.css';

// The map and its data are for whoever scrolls this far.
const JourneyMap = lazy(() => import('./JourneyMap'));

/**
 * "Will I know when it moves?": one parcel travels scan by scan on the app's
 * own map, and a notification drops in for each scan. The moving picture is
 * one image to a screen reader; the words beside it say what it shows.
 */
export function Moves({ scan, card }: {
  /** Which scan of the journey shows. */
  scan: number;
  /** The journey's card: the story plays while it is on screen. */
  card: RefObject<HTMLDivElement | null>;
}) {
  const { t, locale } = useI18n();
  const near = useNear(card);
  const carrier = carrierInfo(JOURNEY_CARRIER, locale);
  const parcel = t('landing.parcel.sneakers');
  return <section className="landing-section landing-moves" aria-labelledby="landing-moves-title">
    <div className="landing-moves__text">
      <h2 id="landing-moves-title">{t('landing.moves.title')}</h2>
      <p>{t('landing.moves.body')}</p>
      <ul className="landing-chips">
        <li><Icon name="clock" />{t('landing.moves.every10')}</li>
        <li><Icon name="truck" />{t('landing.moves.lastMile')}</li>
      </ul>
    </div>
    <div ref={card} className="landing-journey" style={carrierBrand(carrier).style as CSSProperties}>
      <div className="landing-journey__card" role="img" aria-label={t('landing.journey.label')} data-scan={scan}>
        <div className="landing-journey__map">
          {near && <Suspense fallback={null}><JourneyMap scan={scan} /></Suspense>}
          <div className="landing-journey__top">
            <CarrierMark carrier={carrier} />
            <span className="landing-journey__live" data-pulse={JOURNEY[scan].stage !== 'delivered' || undefined}>
              <i />{t('parcel.updated', { date: t('time.minutesAgo', { count: 2 }) })}
            </span>
          </div>
        </div>
        <div className="landing-journey__text">
          <div className="landing-stack">
            {JOURNEY.map(({ stage, headline, detail }, index) => <div key={stage} data-on={index === scan || undefined}>
              <strong>{headline(t)}</strong><span>{detail(t)}</span>
            </div>)}
          </div>
          <ProgressTrack stage={JOURNEY[scan].stage} />
        </div>
      </div>
      {/* The pings as they would arrive. They repeat what the card says, so they are for the eye only. */}
      <div className="landing-pings" aria-hidden="true">
        {JOURNEY.map(({ stage, ping, pingDetail }, index) => <div key={stage} className="landing-ping" data-on={index === scan || undefined}>
          <PeekMark size={34} />
          <span className="landing-ping__text">
            <span><strong>{ping(t, carrier.name)}</strong><small>{t('landing.ping.now')}</small></span>
            <span>{parcel} · {pingDetail(t)}</span>
          </span>
        </div>)}
      </div>
    </div>
  </section>;
}
