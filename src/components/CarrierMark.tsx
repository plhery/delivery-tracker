import type { CarrierInfo } from '../lib/carriers';
import { carrierBrand } from '../lib/carrierBrand';

export function CarrierMark({ carrier }: { carrier: CarrierInfo }) {
  const { family, name } = carrierBrand(carrier);
  return <span className="carrier-mark" data-family={family} title={carrier.name} aria-label={carrier.name}>
    <svg className="carrier-mark__truck" viewBox="0 0 32 21" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="18" height="13" rx="1.3" fill="var(--carrier-truck)" stroke="var(--carrier-edge)" strokeWidth=".6" />
      <path d="M20 8h5l5 5v3H20Z" fill="var(--carrier-truck)" stroke="var(--carrier-edge)" strokeWidth=".6" />
      <path d="M22 9.5h2.5l3 3H22Z" fill="#edf1ee" />
      {family === 'dhl' ? <path d="M4 8h12M3 10h12" stroke="var(--carrier-accent)" strokeWidth="1.1" />
        : family === 'ups' ? <path d="M8 5h5v4c0 2-2.5 3-2.5 3S8 11 8 9Z" fill="var(--carrier-accent)" />
          : <><path d="M5 9h8" stroke="var(--carrier-accent)" strokeWidth="2" /><circle cx="15" cy="9" r="1.1" fill="var(--carrier-accent)" /></>}
      {[8, 25].map(x => <g key={x}><circle cx={x} cy="16.5" r="2.4" fill="#42483d" /><circle cx={x} cy="16.5" r=".9" fill="#d2d4c7" /></g>)}
    </svg>
    <span className="carrier-mark__name" aria-hidden="true">{name}{family === 'gls' && <span className="carrier-mark__dot">.</span>}</span>
  </span>;
}
