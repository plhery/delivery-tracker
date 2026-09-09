import type { CSSProperties } from 'react';
import type { CarrierInfo } from './carriers';

export function carrierBrandFamily(id: string): string {
  return id.startsWith('gls-') ? 'gls' : id;
}

function mix(color: string, base: string, amount: number): string {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color : '#657060';
  return '#' + [1, 3, 5].map(offset => Math.round(
    parseInt(hex.slice(offset, offset + 2), 16) * (1 - amount)
    + parseInt(base.slice(offset, offset + 2), 16) * amount,
  ).toString(16).padStart(2, '0')).join('');
}

/** Only the approved wordmarks need special treatment; new carriers use catalog colors. */
export function carrierBrand(carrier: CarrierInfo) {
  const family = carrierBrandFamily(carrier.id);
  const palettes: Record<string, string[]> = {
    dhl: ['#f7e8aa', '#514727', '#6c5419', '#ead695', '#d40511', '#ffe274', '#ffcc00', '#b88d16', '#d40511'],
    gls: ['#dfebfa', '#293e57', '#355e8a', '#b7d1ee', '#1634a7', '#abc7ff', '#1634a7', '#1634a7', '#ffcf00'],
    ups: ['#ede3d5', '#463a2c', '#78573e', '#dbc2a4', '#573626', '#ebca99', '#573626', '#573626', '#f5c86b'],
  };
  const values = palettes[family] ?? [
    mix(carrier.color, '#ffffff', .86), mix(carrier.color, '#20261f', .8),
    mix(carrier.color, '#000000', .55), mix(carrier.color, '#ffffff', .65),
    mix(carrier.color, '#000000', .3), mix(carrier.color, '#ffffff', .6),
    mix(carrier.color, '#000000', 0), mix(carrier.color, '#000000', .2), '#ffffff',
  ];
  const keys = ['surface-light', 'surface-dark', 'ink-light', 'ink-dark', 'brand-light', 'brand-dark', 'truck', 'edge', 'accent'];
  const style = Object.fromEntries(keys.map((key, index) => [`--carrier-${key}`, values[index]])) as CSSProperties;
  return { family, name: ({ dhl: 'DHL', gls: 'GLS', ups: 'ups' } as Record<string, string>)[family] ?? carrier.name, style };
}
