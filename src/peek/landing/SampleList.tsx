import { useMemo, useState } from 'react';
import { ParcelCard } from '../../components/ParcelCard';
import { useI18n } from '../../i18n';
import { sampleParcels } from './sampleParcels';

/** The cards are a picture of the list: nothing opens. */
const stay = () => undefined;

/** The deliveries list as the app draws it, with three sample parcels: the next one on its map, then the others. */
export default function SampleList() {
  const { t } = useI18n();
  const [now] = useState(() => Date.now());
  const [next, ...others] = useMemo(() => sampleParcels(now, t), [now, t]);
  return <>
    <div className="delivery-next"><ParcelCard parcel={next} variant="hero" onOpen={stay} /></div>
    <div className="parcel-grid">{others.map((parcel) => <ParcelCard key={parcel.id} parcel={parcel} onOpen={stay} />)}</div>
  </>;
}
