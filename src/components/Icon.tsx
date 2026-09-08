import type { CSSProperties, SVGProps } from 'react';

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

type PaperPoint = readonly [number, number];

/** A hinge stays fixed while the paper folds through it, just like the native parcel. */
function ParcelFlap({ points, openedCorner, tone, rear = false, hidden = false }: {
  points: readonly [PaperPoint, PaperPoint, PaperPoint, PaperPoint];
  openedCorner: PaperPoint;
  tone: string;
  rear?: boolean;
  hidden?: boolean;
}) {
  const [origin, hinge, corner] = points;
  const angle = Math.atan2(hinge[1] - origin[1], hinge[0] - origin[0]);
  const local = ([x, y]: PaperPoint) => [
    (x - origin[0]) * Math.cos(angle) + (y - origin[1]) * Math.sin(angle),
    (y - origin[1]) * Math.cos(angle) - (x - origin[0]) * Math.sin(angle),
  ];
  const from = local(corner), to = local(openedCorner);
  const fold = {
    '--fold-scale': to[1] / from[1],
    '--fold-skew': `${Math.atan((to[0] - from[0]) / from[1]) * 180 / Math.PI}deg`,
  } as CSSProperties;
  return <g transform={`translate(${origin.join(' ')}) rotate(${angle * 180 / Math.PI})`}>
    <g className={`parcel-illustration__flap${rear ? ' parcel-illustration__flap--rear' : ''}${hidden ? ' parcel-illustration__flap--hidden' : ''}`} style={fold}>
      <polygon points={points.map((point) => local(point).join(',')).join(' ')} fill={tone} stroke="#987450" strokeOpacity=".24" strokeWidth=".7" />
    </g>
  </g>;
}

/** Kraft paper, printed labels, and a card tucked behind the front faces. */
export function ParcelIllustration({ className = '' }: { className?: string }) {
  return <svg className={`parcel-illustration ${className}`} viewBox="0 0 300 310" fill="none" aria-hidden="true">
    <ellipse className="parcel-illustration__shadow" cx="150" cy="286" rx="84" ry="10" fill="currentColor" opacity=".08" />
    <g className="parcel-illustration__body">
      <path d="m55 142 95-47 95 47-95 48-95-48Z" fill="#806345" />
      <ParcelFlap points={[[55, 142], [150, 95], [190, 143], [95, 190]]} openedCorner={[112, 48]} tone="#C4A078" rear hidden />
      <ParcelFlap points={[[150, 95], [245, 142], [197.5, 166], [102.5, 118.5]]} openedCorner={[270, 88]} tone="#D8B997" rear />
      <ellipse className="parcel-illustration__light" cx="150" cy="140" rx="62" ry="20" fill="#FFE8AE" />
      <g className="parcel-illustration__delivery-card">
        <rect x="110" y="111" width="83" height="111" rx="7" fill="#FCFAF4" stroke="#E6E0D4" strokeWidth=".7" />
        <path d="M112 120v-2a5 5 0 0 1 5-5h69" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="143" cy="145" r="19" fill="#E7ECE4" />
        <path className="parcel-illustration__check" d="m135 145 5 5 11-12" stroke="#587260" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M124 181h45" stroke="#DAD7CE" strokeWidth="4" strokeLinecap="round" />
        <path d="M124 194h29" stroke="#E7E4DC" strokeWidth="4" strokeLinecap="round" />
      </g>
      <path d="m55 142 95 48v87l-95-48v-87Z" fill="#C9A47B" />
      <path d="m150 190 95-48v87l-95 48v-87Z" fill="#B78F66" />
      <path className="parcel-illustration__face-light" d="m55 142 95 48v87l-95-48v-87Z" fill="#FFF4D6" />
      <path d="M56 144v84l93 47m2 0 92-46v-84" stroke="#987450" strokeOpacity=".25" strokeWidth=".8" />
      <path className="parcel-illustration__edge" d="m55 142 95 48 95-48m-95 48v87" stroke="#FFF2CF" strokeWidth="1" />
      <g transform="translate(77 193) rotate(27)">
        <rect width="51" height="32" rx="3" fill="#D8E5EA" />
        <path d="M8 8v17m4-17v17m3-17v17m5-17v17m3-17v17m5-17v17m4-17v17m3-17v17m5-17v17" stroke="#4E677A" strokeWidth="1.5" />
        <path d="M3 5V3h45" stroke="white" strokeOpacity=".5" />
      </g>
      <g transform="translate(201 201) rotate(-27)"><path d="M10 22V4m-5 5 5-5 5 5" stroke="#735C43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g>
      <g transform="translate(183 234) rotate(-27)">
        <circle r="14" fill="#DECCE2" />
        <circle className="parcel-illustration__seal-light" r="11.5" stroke="#FFF6FF" strokeWidth="1.2" />
        <path d="M0-7V7m-6-10 12 6M-6 3 6-3" stroke="#7C6787" strokeWidth="2" strokeLinecap="round" />
      </g>
      <ParcelFlap points={[[245, 142], [150, 190], [110, 142], [205, 95]]} openedCorner={[186, 231]} tone="#D1AE85" hidden />
      <ParcelFlap points={[[55, 142], [150, 190], [197.5, 166], [102.5, 118.5]]} openedCorner={[121, 234]} tone="#DDBD96" />
      <g className="parcel-illustration__tape"><path d="m96 122 13-7 95 48-13 7-95-48Z" fill="#EBDDCA" /><path d="m103 119 94 47" stroke="#AF9474" strokeOpacity=".6" strokeWidth="1" strokeDasharray="3 3" /></g>
      <g className="parcel-illustration__glints" fill="#C9A47B"><path d="m70 84 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z" /><circle cx="225" cy="86" r="2.5" /><path d="m202 52 1.5-4 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5Z" /><circle cx="93" cy="58" r="1.5" /></g>
    </g>
  </svg>;
}
