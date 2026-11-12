import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../cn';

/**
 * The mascot redrawn as layered SVG, so it can change colour, wear cosmetics and show a mood.
 * The brand PNG (see <Mascot>) is used where exact brand art matters; this is used for avatars,
 * the locker, the 404 page and celebrations.
 */

export type MascotMood = 'happy' | 'sad' | 'wow';

export type CosmeticSlot = 'colour' | 'hat' | 'glasses' | 'headphones' | 'glow' | 'frame';

/** Equipped cosmetic codes per slot. Missing slots use the defaults. */
export type AvatarCosmetics = Partial<Record<CosmeticSlot, string>>;

interface Palette {
  body: string;
  dark: string;
  light: string;
}

export const MASCOT_COLOURS: Record<string, Palette> = {
  classic: { body: '#0C2A6E', dark: '#000C30', light: '#4A72C8' },
  ocean: { body: '#0B5D6B', dark: '#042F38', light: '#49BFD0' },
  sunset: { body: '#B4471B', dark: '#521C07', light: '#F7A93B' },
  berry: { body: '#8E1F5F', dark: '#43092B', light: '#EC79B6' },
  forest: { body: '#1E6B3A', dark: '#0A341A', light: '#63D08A' },
  royal: { body: '#4B2A9E', dark: '#200D49', light: '#A186EE' },
};

export const MASCOT_GLOWS: Record<string, string> = {
  cyan: '#00E8FC',
  lime: '#B6FF3C',
  pink: '#FF7AD9',
  gold: '#FFD24A',
  violet: '#B79CFF',
};

export const COSMETIC_CODES: Record<CosmeticSlot, string[]> = {
  colour: Object.keys(MASCOT_COLOURS),
  hat: ['cap', 'crown', 'party', 'wizard', 'beanie', 'graduation'],
  glasses: ['round', 'shades', 'star', 'pixel', 'monocle'],
  headphones: ['studio', 'cat', 'neon', 'retro'],
  glow: Object.keys(MASCOT_GLOWS),
  frame: ['ring-cyan', 'ring-gold', 'hex', 'sparkle'],
};

const FACE = '#FCFCFC';
const GOLD = '#FFD24A';

function Hat({ code, p }: { code?: string; p: Palette }) {
  const outline = { stroke: p.dark, strokeWidth: 4, strokeLinejoin: 'round' as const };
  switch (code) {
    case 'cap':
      return (
        <g>
          <path d="M70 70 C72 30 172 30 176 70 Z" fill="#EF4444" {...outline} />
          <path d="M168 64 C196 60 214 68 218 78 C200 80 182 78 166 74 Z" fill="#B91C1C" {...outline} />
          <circle cx="123" cy="38" r="5" fill="#FCFCFC" stroke={p.dark} strokeWidth="3" />
        </g>
      );
    case 'crown':
      return (
        <g>
          <path d="M74 72 L68 28 L98 50 L122 18 L146 50 L176 28 L170 72 Z" fill={GOLD} {...outline} />
          <circle cx="122" cy="58" r="6" fill="#EF4444" stroke={p.dark} strokeWidth="3" />
          <circle cx="92" cy="60" r="4" fill="#00C0F0" stroke={p.dark} strokeWidth="2.5" />
          <circle cx="152" cy="60" r="4" fill="#00C0F0" stroke={p.dark} strokeWidth="2.5" />
        </g>
      );
    case 'party':
      return (
        <g>
          <path d="M84 74 L124 4 L164 74 Z" fill="#FF7AD9" {...outline} />
          <path d="M100 46 L148 46 M92 60 L156 60" stroke="#FCFCFC" strokeWidth="5" strokeLinecap="round" />
          <circle cx="124" cy="8" r="8" fill={GOLD} stroke={p.dark} strokeWidth="3" />
        </g>
      );
    case 'wizard':
      return (
        <g>
          <path d="M70 76 C96 62 110 30 150 2 C146 34 156 58 178 76 Z" fill="#4B2A9E" {...outline} />
          <path d="M58 78 C92 66 156 66 190 78 C156 88 92 88 58 78 Z" fill="#200D49" {...outline} />
          <path d="M126 40 l3 7 7 1 -5 5 1 7 -6 -4 -6 4 1 -7 -5 -5 7 -1 Z" fill={GOLD} />
        </g>
      );
    case 'beanie':
      return (
        <g>
          <path d="M72 70 C70 26 176 26 174 70 Z" fill="#22C55E" {...outline} />
          <rect x="66" y="62" width="114" height="18" rx="9" fill="#15803D" {...outline} />
          <circle cx="123" cy="28" r="10" fill="#FCFCFC" stroke={p.dark} strokeWidth="3" />
        </g>
      );
    case 'graduation':
      return (
        <g>
          <path d="M88 60 L88 78 C108 88 138 88 158 78 L158 60 Z" fill="#111827" {...outline} />
          <path d="M52 52 L123 26 L194 52 L123 76 Z" fill="#1F2937" {...outline} />
          <path d="M184 54 L186 84" stroke={GOLD} strokeWidth="4" strokeLinecap="round" />
          <circle cx="186" cy="88" r="5" fill={GOLD} />
        </g>
      );
    default:
      return null;
  }
}

function Glasses({ code, p }: { code?: string; p: Palette }) {
  switch (code) {
    case 'round':
      return (
        <g fill="none" stroke={p.dark} strokeWidth="5">
          <circle cx="112" cy="138" r="25" fill="rgb(0 192 240 / 0.14)" />
          <circle cx="177" cy="136" r="25" fill="rgb(0 192 240 / 0.14)" />
          <path d="M137 136 L152 136" />
        </g>
      );
    case 'shades':
      return (
        <g>
          <path d="M84 122 H140 V140 C140 156 84 156 84 140 Z" fill="#0B1220" stroke={p.dark} strokeWidth="4" />
          <path d="M149 120 H205 V138 C205 154 149 154 149 138 Z" fill="#0B1220" stroke={p.dark} strokeWidth="4" />
          <path d="M140 128 H149" stroke={p.dark} strokeWidth="5" />
          <path d="M92 128 L104 128 M157 126 L169 126" stroke="#FCFCFC" strokeWidth="4" strokeLinecap="round" opacity="0.7" />
        </g>
      );
    case 'star': {
      const star = (cx: number, cy: number) => {
        const pts: string[] = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 28 : 13;
          const a = (Math.PI / 5) * i - Math.PI / 2;
          pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
        }
        return pts.join(' ');
      };
      return (
        <g fill="rgb(255 210 74 / 0.3)" stroke={GOLD} strokeWidth="5" strokeLinejoin="round">
          <polygon points={star(112, 138)} />
          <polygon points={star(177, 136)} />
        </g>
      );
    }
    case 'pixel':
      return (
        <g fill="#0B1220">
          <path d="M80 122 H206 V130 H198 V146 H190 V154 H158 V146 H150 V130 H142 V146 H134 V154 H96 V146 H88 V130 H80 Z" />
          <path d="M96 130 H104 V138 H96 Z M112 130 H120 V138 H112 Z M160 130 H168 V138 H160 Z M176 130 H184 V138 H176 Z" fill="#FCFCFC" />
        </g>
      );
    case 'monocle':
      return (
        <g fill="none" stroke={GOLD} strokeWidth="5">
          <circle cx="177" cy="136" r="26" fill="rgb(255 210 74 / 0.16)" />
          <path d="M196 154 C206 170 204 190 196 206" strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    default:
      return null;
  }
}

function HeadphonesBack({ code, p, glow }: { code?: string; p: Palette; glow: string }) {
  const outline = { stroke: p.dark, strokeWidth: 5 };
  switch (code) {
    case 'retro':
      return (
        <g>
          <ellipse cx="42" cy="136" rx="13" ry="22" fill="#F59E0B" {...outline} />
          <ellipse cx="208" cy="132" rx="11" ry="20" fill="#F59E0B" {...outline} />
        </g>
      );
    case 'neon':
      return (
        <g>
          <ellipse cx="40" cy="136" rx="19" ry="31" fill={p.dark} stroke={glow} strokeWidth="5" />
          <ellipse cx="40" cy="136" rx="8" ry="15" fill={glow} opacity="0.9" />
          <ellipse cx="208" cy="132" rx="15" ry="28" fill={p.dark} stroke={glow} strokeWidth="5" />
        </g>
      );
    case 'cat':
      return (
        <g>
          <path d="M52 78 L46 38 L82 62 Z" fill="#FF7AD9" {...outline} strokeLinejoin="round" />
          <path d="M192 78 L200 38 L164 62 Z" fill="#FF7AD9" {...outline} strokeLinejoin="round" />
          <ellipse cx="40" cy="136" rx="19" ry="31" fill="#FF7AD9" {...outline} />
          <ellipse cx="208" cy="132" rx="15" ry="28" fill="#FF7AD9" {...outline} />
        </g>
      );
    default:
      return (
        <g>
          <ellipse cx="40" cy="136" rx="19" ry="31" fill={p.light} {...outline} />
          <path d="M30 118 C26 130 26 142 30 154" stroke="#FCFCFC" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.35" />
          <ellipse cx="208" cy="132" rx="15" ry="28" fill={p.light} {...outline} />
        </g>
      );
  }
}

function Frame({ code }: { code?: string }) {
  switch (code) {
    case 'ring-cyan':
      return <circle cx="120" cy="120" r="114" fill="none" stroke="#00E8FC" strokeWidth="6" />;
    case 'ring-gold':
      return (
        <g fill="none">
          <circle cx="120" cy="120" r="114" stroke={GOLD} strokeWidth="6" />
          <circle cx="120" cy="120" r="106" stroke={GOLD} strokeWidth="2" opacity="0.6" />
        </g>
      );
    case 'hex':
      return (
        <polygon
          points="120,4 220,62 220,178 120,236 20,178 20,62"
          fill="none"
          stroke="#00C0F0"
          strokeWidth="6"
          strokeLinejoin="round"
        />
      );
    case 'sparkle':
      return (
        <g>
          <circle cx="120" cy="120" r="114" fill="none" stroke="#B79CFF" strokeWidth="4" strokeDasharray="2 12" strokeLinecap="round" />
          {[
            [28, 40],
            [212, 46],
            [222, 190],
            [22, 196],
          ].map(([x, y]) => (
            <path
              key={`${x}-${y}`}
              d={`M${x} ${y! - 10} L${x! + 3} ${y! - 3} L${x! + 10} ${y} L${x! + 3} ${y! + 3} L${x} ${y! + 10} L${x! - 3} ${y! + 3} L${x! - 10} ${y} L${x! - 3} ${y! - 3} Z`}
              fill={GOLD}
            />
          ))}
        </g>
      );
    default:
      return null;
  }
}

export interface MascotAvatarProps {
  size?: number | string;
  mood?: MascotMood;
  cosmetics?: AvatarCosmetics | null;
  /** Idle float + blink + brain pulse. Off by default for small avatars in lists. */
  animated?: boolean;
  /** Accessible name. Leave empty when the avatar is decorative. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function MascotAvatar({
  size = 96,
  mood = 'happy',
  cosmetics,
  animated = false,
  label,
  className,
  style,
}: MascotAvatarProps) {
  const p = MASCOT_COLOURS[cosmetics?.colour ?? 'classic'] ?? MASCOT_COLOURS.classic!;
  const glow = MASCOT_GLOWS[cosmetics?.glow ?? 'cyan'] ?? MASCOT_GLOWS.cyan!;
  const sad = mood === 'sad';
  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn('bgm', animated && 'bgm--animated', className)}
      style={style}
    >
      <Frame code={cosmetics?.frame} />
      <g className="bgm__body">
        {/* antennae: they droop when sad */}
        <g strokeLinecap="round" transform={sad ? 'rotate(-14 60 88)' : undefined}>
          <path d="M41 44 L60 88" stroke={p.dark} strokeWidth="23" />
          <path d="M41 44 L60 88" stroke={p.body} strokeWidth="15" />
        </g>
        <g strokeLinecap="round" transform={sad ? 'rotate(14 188 86)' : undefined}>
          <path d="M201 52 L188 86" stroke={p.dark} strokeWidth="23" />
          <path d="M201 52 L188 86" stroke={p.body} strokeWidth="15" />
        </g>
        {/* speech-bubble head with its tail */}
        <path
          d="M62.3 162.1 L58 226 L101.8 187.3 A78 78 0 1 0 62.3 162.1 Z"
          fill={p.body}
          stroke={p.dark}
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <ellipse cx="128" cy="76" rx="60" ry="42" fill={p.dark} />
        <HeadphonesBack code={cosmetics?.headphones} p={p} glow={glow} />
        {/* brain */}
        <g
          className="bgm__brain"
          fill="none"
          stroke={glow}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={sad ? 0.55 : 1}
          style={{ filter: `drop-shadow(0 0 5px ${glow})` }}
        >
          <path d="M78 96 C66 84 72 64 90 62 C90 46 112 38 124 48 C134 34 162 38 164 54 C182 52 192 72 182 88" />
          <path d="M104 96 C96 84 104 70 118 74" />
          <path d="M124 48 C128 60 120 68 112 66" />
          <path d="M140 96 C130 80 144 62 160 70 C170 76 166 90 154 90" />
          <path d="M164 54 C160 62 152 64 146 60" />
        </g>
        {/* visor and controller face */}
        <rect x="54" y="92" width="166" height="94" rx="46" fill={p.body} stroke={p.dark} strokeWidth="5" />
        <rect x="70" y="104" width="134" height="70" rx="34" fill={FACE} />
        <path d="M76 150 C92 176 182 176 198 150 C196 166 184 174 170 174 L104 174 C90 174 78 166 76 150 Z" fill="#DCE6F2" />
        {/* eyes: a d-pad and four buttons that blink */}
        <g className="bgm__eyes-open" fill={p.dark}>
          <rect x="94" y="132" width="36" height="12" rx="3.5" />
          <rect x="106" y="120" width="12" height="36" rx="3.5" />
          <circle cx="176" cy="122" r="6" />
          <circle cx="165" cy="136" r="6" />
          <circle cx="187" cy="135" r="6" />
          <circle cx="177" cy="148" r="6" />
        </g>
        <g className="bgm__eyes-closed" stroke={p.dark} strokeWidth="6" strokeLinecap="round">
          <path d="M97 138 L127 138" />
          <path d="M163 136 L190 136" />
        </g>
        {mood === 'wow' ? (
          <ellipse cx="148" cy="158" rx="6" ry="7.5" fill={p.dark} />
        ) : (
          <path
            d={sad ? 'M136 162 Q148 151 161 162' : 'M136 154 Q148 165 161 153'}
            fill="none"
            stroke={p.dark}
            strokeWidth="5.5"
            strokeLinecap="round"
          />
        )}
        {sad ? <path d="M92 150 q-5 9 0 13 q5 -4 0 -13 Z" fill="#00C0F0" /> : null}
        <Glasses code={cosmetics?.glasses} p={p} />
        <Hat code={cosmetics?.hat} p={p} />
      </g>
    </svg>
  );
}
