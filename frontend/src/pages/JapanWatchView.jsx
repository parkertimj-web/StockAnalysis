import { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import api from '../api/client.js';
import Tip from '../components/common/Tip.jsx';

function fmt(n, d = 1) { return n != null && !isNaN(n) ? Number(n).toFixed(d) : '—'; }

function StatCard({ label, value, sub, tone = 'text-gray-100', tip }) {
  return (
    <div className="card p-3 text-center">
      <div className="text-gray-300 text-[10px] flex items-center justify-center gap-0.5">
        {label}{tip && <Tip below text={tip} />}
      </div>
      <div className={`text-lg font-semibold mono ${tone}`}>{value}</div>
      {sub && <div className="text-gray-400 text-[9px] mt-0.5">{sub}</div>}
    </div>
  );
}

const SCEN_TONE = {
  low: 'text-green-400 border-green-800',
  moderate: 'text-yellow-400 border-yellow-800',
  'high-good': 'text-blue-400 border-blue-800',
  high: 'text-red-400 border-red-800',
};

function List({ title, items, dot }) {
  return (
    <div className="card p-3">
      <div className="text-xs font-semibold text-gray-200 mb-2">{title}</div>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-1.5 text-[11px] text-gray-300 leading-snug">
            <span className={`mt-1 shrink-0 w-1.5 h-1.5 rounded-full ${dot}`} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function JapanWatchView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/macro/japan')
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message));
  }, []);

  const s = data?.snapshot;
  const risk = data?.risk;
  const fw = data?.framework;
  const diff = risk?.differential;

  const riskTone = risk?.level === 'High' ? 'text-red-400'
    : risk?.level === 'Moderate' ? 'text-yellow-400' : 'text-green-400';

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-200">Japan / US-Treasury Watch</h1>
          {data && (
            <span className={`text-[10px] border rounded px-1.5 py-0.5 ${data.live ? 'border-green-800 text-green-400' : 'border-gray-700 text-gray-400'}`}>
              {data.live ? `live · FRED · ${s?.asOf}` : `curated · as of ${s?.asOf}`}
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-1 max-w-3xl">
          Japan is the largest foreign holder of US Treasuries. A weak yen can pressure Tokyo to sell
          those reserves to defend its currency — which would push US yields up. This tracks the key
          gauges and weighs how elevated that sell-off risk is. Educational context, not investment advice.
        </p>
      </div>

      {error && <div className="card p-3 text-red-400 text-xs">{error}</div>}

      {s && (
        <>
          {/* ── Snapshot ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="USD/JPY" value={fmt(s.usdjpy)} tone={s.usdjpy >= 160 ? 'text-red-400' : 'text-gray-100'}
              sub={`40yr low ¥${s.usdjpy40yrLow}`} tip="Yen per dollar. Higher = weaker yen. ~160+ has drawn intervention." />
            <StatCard label="BOJ rate" value={`${fmt(s.bojRate)}%`} sub="1995 high" tip="Bank of Japan policy rate." />
            <StatCard label="Fed funds" value={`${fmt(s.fedRate, 2)}%`} tip="US policy rate." />
            <StatCard label="Rate gap" value={diff != null ? `${fmt(diff, 2)}%` : '—'}
              tone={diff >= 2.5 ? 'text-red-400' : 'text-yellow-400'} sub="Fed − BOJ"
              tip="The wider the US–Japan rate gap, the more the yen weakens — the core driver." />
            <StatCard label="Japan holdings" value={`$${(s.japanHoldingsB / 1000).toFixed(2)}T`} sub="largest foreign holder"
              tip="Japan's US Treasury holdings (TIC data)." />
            <StatCard label="Foreign total" value={`$${fmt(s.foreignTotalT)}T`} sub={`Japan ≈ ${((s.japanHoldingsB/1000)/s.foreignTotalT*100).toFixed(0)}%`}
              tip="All foreign-held US Treasuries." />
          </div>

          {/* ── Risk gauge + USD/JPY chart ───────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-semibold text-gray-200">Sell-off risk</h2>
                <Tip below text="How many conditions that would push Japan toward selling Treasuries are present now. Educational gauge, not a forecast." />
              </div>
              <div className="flex items-baseline gap-2 mb-3">
                <span className={`text-2xl font-bold ${riskTone}`}>{risk?.level}</span>
                <span className="text-[11px] text-gray-400">{risk?.flags}/{risk?.scored} risk conditions present</span>
              </div>
              <div className="space-y-1.5">
                {risk?.checks.map(c => (
                  <div key={c.key} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-gray-300">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        c.present == null ? 'bg-gray-600' : c.present ? 'bg-red-500' : 'bg-green-500'}`} />
                      {c.label}
                    </span>
                    <span className="mono text-gray-400">{c.detail}</span>
                  </div>
                ))}
              </div>
              {s.lastIntervention && (
                <div className="text-[10px] text-gray-500 mt-3 border-t border-gray-800 pt-2">
                  Last intervention <span className="text-gray-300 mono">{s.lastIntervention}</span> — first joint US–Japan
                  yen purchase since 1998. {s.fimaRepo && 'Japan is using the Fed’s FIMA repo to raise dollars against Treasuries rather than selling them.'}
                </div>
              )}
            </div>

            {/* USD/JPY history (live only) */}
            <div className="card p-4">
              <div className="text-xs font-semibold text-gray-200 mb-2">USD/JPY (2y)</div>
              {data.series?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.series} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="jpy" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f87171" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#9ca3af' }} minTickGap={40} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#9ca3af' }} width={38} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 11 }}
                      formatter={(v) => [fmt(v, 2), 'USD/JPY']} />
                    <ReferenceLine y={160} stroke="#ef4444" strokeDasharray="3 3"
                      label={{ value: 'intervention ~160', fontSize: 9, fill: '#ef4444', position: 'insideTopRight' }} />
                    <Area type="monotone" dataKey="value" stroke="#f87171" strokeWidth={1.5} fill="url(#jpy)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-[11px] text-gray-400 h-[220px] flex items-center justify-center text-center px-4">
                  Live USD/JPY history needs a <span className="mono text-gray-300 mx-1">FRED_API_KEY</span> in
                  <span className="mono text-gray-300 ml-1">backend/.env</span>. The snapshot and risk framework work without it.
                </div>
              )}
            </div>
          </div>

          {/* ── Scenario framework ───────────────────────────────────── */}
          {fw && (
            <div className="card overflow-x-auto">
              <div className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-200">How the risk plays out — four scenarios</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-300">
                    <th className="px-4 py-2 text-left font-medium">Scenario</th>
                    <th className="px-4 py-2 text-left font-medium">Likelihood</th>
                    <th className="px-4 py-2 text-left font-medium">US impact</th>
                  </tr>
                </thead>
                <tbody>
                  {fw.scenarios.map(sc => (
                    <tr key={sc.key} className="border-b border-gray-800/50">
                      <td className="px-4 py-2 text-gray-100 font-medium whitespace-nowrap">{sc.name}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] border rounded px-1.5 py-0.5 ${SCEN_TONE[sc.tone]}`}>{sc.likelihood}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-[11px]">{sc.usImpact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Why unlikely / raises / lowers ───────────────────────── */}
          {fw && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <List title="Why a big sell-off is unlikely" items={fw.whyUnlikely} dot="bg-green-500" />
              <List title="What would raise the risk" items={fw.raisesRisk} dot="bg-red-500" />
              <List title="What lowers it (the real fix)" items={fw.lowersRisk} dot="bg-blue-500" />
            </div>
          )}

          <p className="text-[10px] text-gray-500">
            Sources: US Treasury TIC data, FRED (DEXJPUS, FEDFUNDS), Bank of Japan, and reporting on the
            July 2026 joint US–Japan intervention. Approximate, educational reference — not investment advice.
          </p>
        </>
      )}
    </div>
  );
}
