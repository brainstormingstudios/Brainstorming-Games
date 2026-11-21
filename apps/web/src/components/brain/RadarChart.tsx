'use client';

import { SKILLS, type SkillMap } from '@/lib/domain/brain';

export interface RadarSeries {
  label: string;
  values: SkillMap;
  /** Tailwind text colour class; the shape uses currentColor. */
  colorClass: string;
  dashed?: boolean;
}

const SIZE = 320;
const C = SIZE / 2;
const R = 112;

const point = (i: number, value: number) => {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / SKILLS.length;
  const r = (R * Math.max(0, Math.min(100, value))) / 100;
  return [C + r * Math.cos(angle), C + r * Math.sin(angle)] as const;
};

/**
 * The Brain Profile pentagon: one axis per skill, 0 at the centre and 100 at the edge.
 * Up to two series (you, and a friend you compare with). The numbers are also in the cards
 * next to it, so the chart is decorative for screen readers.
 */
export function RadarChart({ series, labels }: { series: RadarSeries[]; labels: Record<string, string> }) {
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full max-w-80" aria-hidden="true" data-testid="brain-radar">
      {[25, 50, 75, 100].map((ring) => (
        <polygon
          key={ring}
          points={SKILLS.map((_, i) => point(i, ring).join(',')).join(' ')}
          className="fill-none stroke-(--border)"
          strokeWidth={1}
        />
      ))}
      {SKILLS.map((s, i) => {
        const [x, y] = point(i, 100);
        const [lx, ly] = point(i, 122);
        return (
          <g key={s}>
            <line x1={C} y1={C} x2={x} y2={y} className="stroke-(--border)" strokeWidth={1} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-(--fg-muted) text-[13px] font-bold">
              {labels[s]}
            </text>
          </g>
        );
      })}
      {series.map((s) => (
        <g key={s.label} className={s.colorClass}>
          <polygon
            points={SKILLS.map((k, i) => point(i, s.values[k]).join(',')).join(' ')}
            fill="currentColor"
            fillOpacity={s.dashed ? 0.08 : 0.22}
            stroke="currentColor"
            strokeWidth={2.5}
            strokeDasharray={s.dashed ? '6 5' : undefined}
            strokeLinejoin="round"
          />
          {SKILLS.map((k, i) => {
            const [x, y] = point(i, s.values[k]);
            return <circle key={k} cx={x} cy={y} r={3.5} fill="currentColor" />;
          })}
        </g>
      ))}
    </svg>
  );
}
