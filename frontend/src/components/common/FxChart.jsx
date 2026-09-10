import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const RANGES = [
  { key: '1M', months: 1 },
  { key: '3M', months: 3 },
  { key: '6M', months: 6 },
  { key: '1Y', months: 12 },
  { key: '2Y', months: 24 },
];

function sliceMonths(series, months) {
  if (!series?.length) return series;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const iso = cutoff.toISOString().slice(0, 10);
  return series.filter(p => p.date >= iso);
}

function fmt(v, d) { return v != null && !isNaN(v) ? Number(v).toFixed(d) : '—'; }

/**
 * FX area chart with a timeframe selector.
 * @param {Array}  series   [{date, value}] daily, oldest→newest (up to ~2y)
 * @param {string} label    e.g. "USD/JPY"
 * @param {number} [refLine] optional horizontal reference level
 * @param {string} [refLabel] label for the reference line
 * @param {string} [color]  stroke/fill color (default red)
 * @param {number} [decimals] tooltip/axis precision (default 2)
 * @param {string} [defaultRange] one of 1M/3M/6M/1Y/2Y (default 1Y)
 */
export default function FxChart({
  series, label, refLine = null, refLabel, color = '#f87171',
  decimals = 2, defaultRange = '1Y', height = 220,
}) {
  const [range, setRange] = useState(defaultRange);
  const gid = `fx-${label.replace(/[^a-z0-9]/gi, '')}`;

  const months = RANGES.find(r => r.key === range)?.months ?? 12;
  const data = sliceMonths(series, months);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-gray-200">{label}</div>
        <div className="flex gap-0.5">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                range === r.key
                  ? 'bg-blue-600/30 text-blue-300'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      {data?.length ? (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#9ca3af' }} minTickGap={40} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#9ca3af' }} width={44}
              tickFormatter={(v) => fmt(v, decimals)} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 11 }}
              formatter={(v) => [fmt(v, decimals + 1), label]} />
            {refLine != null && (
              <ReferenceLine y={refLine} stroke="#ef4444" strokeDasharray="3 3"
                label={{ value: refLabel, fontSize: 9, fill: '#ef4444', position: 'insideTopRight' }} />
            )}
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#${gid})`} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="text-[11px] text-gray-400 flex items-center justify-center text-center px-4"
          style={{ height }}>
          {label} history is temporarily unavailable (rate source unreachable).
        </div>
      )}
    </div>
  );
}
