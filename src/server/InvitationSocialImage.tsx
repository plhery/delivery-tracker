import { ImageResponse } from 'next/og';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { invitationInitial } from '../lib/invitationInitial';
import { invitationInitialPath } from '../lib/invitationInitialPath';

// Preserve ImageResponse's bundled sans face when adding the serif name font.
const sansFont = readFileSync(join(process.cwd(), 'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf'));
const nameFont = readFileSync(join(process.cwd(), 'public/fonts/gelasio/Gelasio-SemiBoldItalic.ttf'));

/** A still of the welcome parcel: the same kraft paper, face and seal. */
export function invitationSocialImage(nickname: string | null): ImageResponse {
  const initial = invitationInitial(nickname);
  const initialPath = invitationInitialPath(initial);
  // Project the seal's SVG coordinates into ImageResponse's 360 × 300 image.
  const parcelScale = 300 / 215;
  const sealSize = 28 * parcelScale;
  const sealLeft = (183 - 25) * (360 / 250) - sealSize / 2;
  const sealTop = (234 - 85) * parcelScale - sealSize / 2;
  const nameLength = [...(nickname ?? '')].length;
  const greetingSize = nameLength > 18 ? 34 : nameLength > 12 ? 44 : 54;
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#F4F5F1', color: '#26372E', padding: '38px 60px', fontFamily: 'Geist' }}>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 20, color: '#637568', letterSpacing: 1 }}>PEEK</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 1020, height: 160, marginTop: 4, textAlign: 'center', fontWeight: 700, lineHeight: 1.15 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: greetingSize * 0.26, fontSize: greetingSize }}>
          <span>{nickname ? 'Your friend' : 'A friend'}</span>
          {nickname && <span style={{ fontFamily: 'Gelasio', fontStyle: 'italic', fontWeight: 600 }}>{nickname}</span>}
        </div>
        <div style={{ display: 'flex', fontSize: 54 }}>sent you an invitation</div>
      </div>
      <div style={{ display: 'flex', position: 'relative', width: 360, height: 300 }}>
      <svg width="360" height="300" viewBox="25 85 250 215" fill="none">
        <ellipse cx="150" cy="286" rx="84" ry="10" fill="#26372E" opacity=".08" />
        <path d="m55 142 95-47 95 47-95 48-95-48Z" fill="#DDBD96" />
        <path d="m55 142 95 48v87l-95-48v-87Z" fill="#C9A47B" />
        <path d="m150 190 95-48v87l-95 48v-87Z" fill="#B78F66" />
        <path d="M56 144v84l93 47m2 0 92-46v-84" stroke="#987450" strokeOpacity=".25" strokeWidth=".8" />
        <path d="m55 142 95 48 95-48m-95 48v87" stroke="#FFF2CF" strokeWidth="1" />
        <g transform="matrix(1 0.505263 0 1 55 142)">
          {[32.5, 63.5].map((x) => <g key={x}>
            <ellipse cx={x} cy="36" rx="10" ry="11.5" fill="#FFFDF6" />
            <circle cx={x + 3.5} cy="34.6" r="5.4" fill="#20251E" />
            <circle cx={x + 1.7} cy="32.6" r="1.6" fill="#FFFFFF" />
            <ellipse cx={x - 1} cy="51" rx="6.5" ry="3.2" fill="#E9958F" opacity=".55" />
          </g>)}
          <path d="M42 51Q48 58 54 51" stroke="#20251E" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <g transform="translate(201 201) rotate(-27)"><path d="M10 22V4m-5 5 5-5 5 5" stroke="#735C43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g>
        <g transform="translate(183 234) rotate(-27)">
          <circle r="14" fill="#DECCE2" />
          <circle r="11.5" stroke="#FFF6FF" strokeWidth="1.2" />
          {initialPath && <path d={initialPath} stroke="#7C6787" strokeWidth="1.5" strokeLinejoin="round" />}
          {!initial && <path d="M0-7V7m-6-10 12 6M-6 3 6-3" stroke="#7C6787" strokeWidth="1.5" strokeLinecap="round" />}
        </g>
        <path d="m96 122 13-7 95 48-13 7-95-48Z" fill="#EBDDCA" />
        <path d="m103 119 94 47" stroke="#AF9474" strokeOpacity=".6" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
      {initial && !initialPath && <div style={{ display: 'flex', position: 'absolute', left: sealLeft, top: sealTop, width: sealSize, height: sealSize, alignItems: 'center', justifyContent: 'center', fontSize: 18 * parcelScale, color: '#7C6787', transform: 'rotate(-27deg)', lineHeight: 1 }}>{initial}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, fontSize: 28, color: '#526E5B' }}>Tap to open your parcel →</div>
    </div>,
    {
      width: 1200, height: 630,
      fonts: [
        { name: 'Geist', data: sansFont, weight: 400, style: 'normal' },
        { name: 'Gelasio', data: nameFont, weight: 600, style: 'italic' },
      ],
      headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    },
  );
}
