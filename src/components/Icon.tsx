import type { SVGProps } from 'react';

const paths = {
  parcel: 'M3 7l9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10M7.5 4.5l9 5',
  truck: 'M3 5h11v12H3V5Zm11 5h4l3 4v3h-7M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  passport: 'M6 3h13v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 0v18M10 10a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm0 7h6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M6 18 18 6M6 6h12v12',
  chevron: 'm9 5 7 7-7 7',
  back: 'm15 5-7 7 7 7',
  refresh: 'M19 8a7.5 7.5 0 1 0 .2 7.6M19 4v4h-4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
  account: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  archive: 'M4 5h16v4H4V5Zm2 4v11h12V9M10 13h4',
  check: 'm5 12 4 4L19 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 6v6l4 2',
  express: 'm13 2-9 12h7l-1 8L21 9h-8l1-7',
  stamp: 'M4 3h16v18H4V3Zm3 3h10v12H7V6Zm3 4 2 3 3-5',
  location: 'M19 9c0 6-7 12-7 12S5 15 5 9a7 7 0 0 1 14 0Zm-4 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  lock: 'M5 10h14v11H5V10Zm3 0V7a4 4 0 0 1 8 0v3M12 14v3',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1',
  moon: 'M20 15a9 9 0 0 1-11-11A9 9 0 1 0 20 15Z',
  system: 'M3 4h18v13H3V4Zm5 17h8M12 17v4',
  exit: 'M10 3H4v18h6M10 12h11m-5-5 5 5-5 5',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  mail: 'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  copy: 'M9 8h12v13H9V8ZM6 16H3V3h12v2',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}

export function PostageStamp({ icon = 'truck' }: { icon?: IconName }) {
  return <span className="postage-stamp" aria-hidden="true"><span className="postage-stamp__print"><Icon name={icon} /></span><span className="postage-stamp__cancel" /></span>;
}

/** The same illustration stays mounted while the welcome opens into sign-in. */
export function ParcelIllustration({ className = '' }: { className?: string }) {
  return <svg className={`parcel-illustration ${className}`} viewBox="0 0 300 300" fill="none" aria-hidden="true">
    <ellipse className="parcel-illustration__shadow" cx="150" cy="257" rx="85" ry="12" fill="currentColor" opacity=".08" />
    <g className="parcel-illustration__body">
      <path d="m54 113 96-48 96 48-96 50-96-50Z" fill="#AA7E35" />
      <path className="parcel-illustration__inside" d="m69 115 81-38 81 38-81 40-81-40Z" fill="#725A34" />
      <path d="m54 113 96 50v90l-96-49v-91Z" fill="#E5BA55" />
      <path d="m150 163 96-50v91l-96 49v-90Z" fill="#F3CF48" />
      <path d="m150 163 96-50v91l-96 49v-90Z" stroke="#A68235" strokeOpacity=".25" />
      <g className="parcel-illustration__flap parcel-illustration__flap--left"><path d="m54 113 96-48 48 25-96 48-48-25Z" fill="#F4D577" /><path d="m54 113 48 25 96-48" stroke="#C29A46" strokeWidth="1" /></g>
      <g className="parcel-illustration__flap parcel-illustration__flap--right"><path d="m102 138 96-48 48 23-96 50-48-25Z" fill="#F8DF8C" /><path d="m102 138 48 25 96-50" stroke="#C29A46" strokeWidth="1" /></g>
      <path className="parcel-illustration__tape" d="m95 93 14-7 97 49-14 7-97-49Z" fill="#E4B939" /><path d="m95 134 14 7v33l-14-7v-33Z" fill="#D1A339" />
      <g transform="matrix(1 .51 0 1 73 167)"><rect width="47" height="29" rx="3" fill="#FFF9E8" /><path d="M7 8h25M7 13h18M7 19h3m4 0h2m4 0h3m4 0h2m4 0h5" stroke="#826838" strokeWidth="2" /></g>
      <g transform="matrix(1 -.51 0 1 195 165)"><rect width="30" height="34" rx="2" fill="#FFF9E8" /><path d="M7 24V11l8-4 8 4v13l-8 4-8-4Zm0-13 8 4 8-4m-8 4v13" stroke="#6B673A" strokeWidth="1.5" /></g>
    </g>
  </svg>;
}
