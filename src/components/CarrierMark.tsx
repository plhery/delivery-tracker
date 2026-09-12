import { CARRIER_TRUCK } from '@carriers/core/brand';
import type { TruckDecalShape } from '@carriers/core/brand';
import type { CarrierInfo } from '../lib/carriers';
import { carrierBrand } from '../lib/carrierBrand';

/** SVG numbers in the compact spelling the markup uses: `0.6` is written `.6`. */
function n(value: number): string {
  return String(value).replace(/^(-?)0\./, '$1.');
}

/** A paint is a hex literal, or the name of one of the nine brand properties. */
function paint(value: string): string {
  return value.startsWith('#') ? value : `var(--carrier-${value})`;
}

function Decal({ shape }: { shape: TruckDecalShape }) {
  if (shape.type === 'circle') {
    return <circle cx={n(shape.cx)} cy={n(shape.cy)} r={n(shape.r)} fill={paint(shape.fill)} />;
  }
  if (shape.type === 'polygon') return <path d={shape.d} fill={paint(shape.fill)} />;
  return <path d={shape.d} stroke={paint(shape.stroke)} strokeWidth={n(shape.strokeWidth)} />;
}

export function CarrierMark({ carrier }: { carrier: CarrierInfo }) {
  const { family, name, decal } = carrierBrand(carrier);
  const { viewBox, strokeWidth, body, cab, windshield, wheels, decals } = CARRIER_TRUCK;
  return <span className="carrier-mark" data-family={family} title={carrier.name} aria-label={carrier.name}>
    <svg className="carrier-mark__truck" viewBox={`0 0 ${n(viewBox.width)} ${n(viewBox.height)}`} fill="none" aria-hidden="true">
      <rect x={n(body.x)} y={n(body.y)} width={n(body.width)} height={n(body.height)} rx={n(body.rx)} fill={paint(body.fill)} stroke={paint(body.stroke)} strokeWidth={n(strokeWidth)} />
      <path d={cab.d} fill={paint(cab.fill)} stroke={paint(cab.stroke)} strokeWidth={n(strokeWidth)} />
      <path d={windshield.d} fill={paint(windshield.fill)} />
      {decals[decal].map(shape => <Decal key={shape.type + ('d' in shape ? shape.d : shape.cx)} shape={shape} />)}
      {wheels.centers.map(([x, y]) => <g key={x}>
        <circle cx={n(x)} cy={n(y)} r={n(wheels.tire.r)} fill={paint(wheels.tire.fill)} />
        <circle cx={n(x)} cy={n(y)} r={n(wheels.hub.r)} fill={paint(wheels.hub.fill)} />
      </g>)}
    </svg>
    <span className="carrier-mark__name" aria-hidden="true">{name}{family === 'gls' && <span className="carrier-mark__dot">.</span>}</span>
  </span>;
}
