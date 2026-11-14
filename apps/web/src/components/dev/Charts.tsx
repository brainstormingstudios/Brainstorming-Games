'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * Chart wrappers in brand colours. Loaded with next/dynamic so Recharts never touches the
 * player-facing bundles.
 */
const AXIS = { stroke: 'var(--fg-muted)', fontSize: 12, tickLine: false, axisLine: false } as const;
const TOOLTIP = {
  contentStyle: { background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--fg)' },
  labelStyle: { color: 'var(--fg-muted)' },
} as const;

export interface SeriesPoint {
  label: string;
  [series: string]: number | string | null;
}

export function TrendChart({
  data,
  series,
  kind = 'area',
  height = 220,
  format,
  label,
}: {
  data: SeriesPoint[];
  series: { key: string; name: string; colour?: string }[];
  kind?: 'area' | 'line' | 'bar';
  height?: number;
  format?: (v: number) => string;
  label: string;
}) {
  const colours = ['#00c0f0', '#ffb020', '#3ddc84', '#ff8a5c'];
  const fmt = (v: unknown) => (typeof v === 'number' && format ? format(v) : String(v ?? ''));
  const common = (
    <>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="label" {...AXIS} minTickGap={24} />
      <YAxis {...AXIS} width={44} tickFormatter={(v: number) => fmt(v)} />
      <Tooltip {...TOOLTIP} formatter={(v) => fmt(v)} />
    </>
  );
  return (
    <figure aria-label={label} className="w-full">
      <ResponsiveContainer width="100%" height={height}>
        {kind === 'bar' ? (
          <BarChart data={data}>
            {common}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.colour ?? colours[i % colours.length]} radius={[6, 6, 0, 0]} />
            ))}
          </BarChart>
        ) : kind === 'line' ? (
          <LineChart data={data}>
            {common}
            {series.map((s, i) => (
              <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.colour ?? colours[i % colours.length]} strokeWidth={2.5} dot={false} connectNulls />
            ))}
          </LineChart>
        ) : (
          <AreaChart data={data}>
            {common}
            {series.map((s, i) => {
              const c = s.colour ?? colours[i % colours.length];
              return <Area key={s.key} dataKey={s.key} name={s.name} stroke={c} fill={c} fillOpacity={0.18} strokeWidth={2.5} connectNulls />;
            })}
          </AreaChart>
        )}
      </ResponsiveContainer>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}

export default TrendChart;
