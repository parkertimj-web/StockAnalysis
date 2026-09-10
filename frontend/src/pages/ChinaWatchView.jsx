import { useEffect, useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../api/client.js';
import Tip from '../components/common/Tip.jsx';
import NewsFeed from '../components/common/NewsFeed.jsx';

function fmt(n, d = 2) { return n != null && !isNaN(n) ? Number(n).toFixed(d) : '—'; }

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

const PILLAR_TONE = {
  high: 'text-green-400 border-green-800',
  moderate: 'text-yellow-400 border-yellow-800',
  low: 'text-gray-400 border-gray-700',
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

export default function ChinaWatchView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/macro/china')
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message));
  }, []);

  const s = data?.snapshot;
  const m = data?.momentum;
  const fw = data?.framework;

  const momTone = m?.level === 'High' ? 'text-orange-400'
    : m?.level === 'Moderate' ? 'text-yellow-400' : 'text-gray-300';

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-200">China / De-Dollarization Watch</h1>
          {data && (
            <span className={`text-[10px] border rounded px-1.5 py-0.5 ${data.live ? 'border-green-800 text-green-400' : 'border-gray-700 text-gray-400'}`}>
              {data.live ? `live · USD/CNY ${s?.asOf}` : `curated · as of ${s?.asOf}`}
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-1 max-w-3xl">
          China's drive to shift global trade and reserves off the dollar — pricing oil in yuan,
          stockpiling sanctions-proof gold, rotating out of US Treasuries, and building non-SWIFT
          payment rails. Educational context, not investment advice; figures approximate.
        </p>
      </div>

      {error && <div className="card p-3 text-red-400 text-xs">{error}</div>}

      {s && (
        <>
          {/* ── Snapshot ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="USD/CNY" value={fmt(s.usdcny)} sub="yuan per dollar"
              tip="Onshore yuan is tightly managed by the PBoC within a band." />
            <StatCard label="PBoC gold" value={`${s.pbocGoldTonnes.toLocaleString()}t`} tone="text-yellow-400"
              sub="record" tip="China's reported central-bank gold reserves, tonnes." />
            <StatCard label="Gold % reserves" value={`~${s.goldPctReserves}%`} sub="< 10%"
              tip="Gold as a share of China's total reserves — still small, lots of runway." />
            <StatCard label="China UST" value={`$${s.chinaUstB}B`} tone="text-red-400"
              sub={`was $${(s.ustPeakB / 1000).toFixed(1)}T (2013)`} tip="China's US Treasury holdings — an 18-year low." />
            <StatCard label="Yuan in SWIFT" value={`~${fmt(s.yuanSwiftPct, 1)}%`} sub="vs USD dominance"
              tip="Yuan share of global SWIFT payments — still tiny." />
            <StatCard label="USD reserves" value={`${s.usdReservePct}%`} sub="25yr low"
              tip="Dollar share of global FX reserves — drifting down, still dominant." />
          </div>

          {/* ── Momentum + news ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-semibold text-gray-200">De-dollarization momentum</h2>
                <Tip below text="How many structural shifts off the dollar are active now. Momentum is real — but it is not the same as replacing the dollar (see limits below)." />
              </div>
              <div className="flex items-baseline gap-2 mb-3">
                <span className={`text-2xl font-bold ${momTone}`}>{m?.level}</span>
                <span className="text-[11px] text-gray-400">{m?.flags}/{m?.scored} structural shifts active</span>
              </div>
              <div className="space-y-1.5">
                {m?.checks.map(c => (
                  <div key={c.key} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-gray-300">
                      <span className={`inline-block w-2 h-2 rounded-full ${c.present ? 'bg-orange-500' : 'bg-gray-600'}`} />
                      {c.label}
                    </span>
                    <span className="mono text-gray-400">{c.detail}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-gray-500 mt-3 border-t border-gray-800 pt-2">
                Momentum ≠ replacement: capital controls and shallow markets keep the yuan a niche reserve currency.
                The dollar is still ~{s.usdReservePct}% of reserves.
              </div>
            </div>

            <NewsFeed topic="china" title="Latest — China / de-dollarization" />
          </div>

          {/* ── Charts: gold up, Treasuries down ─────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="text-xs font-semibold text-gray-200 mb-2">PBoC gold reserves (tonnes)</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.series.gold} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#eab308" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#eab308" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#9ca3af' }} width={40} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 11 }}
                    formatter={(v) => [`${v.toLocaleString()} t`, 'Gold']} />
                  <Area type="monotone" dataKey="value" stroke="#eab308" strokeWidth={1.5} fill="url(#gold)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-4">
              <div className="text-xs font-semibold text-gray-200 mb-2">China US Treasury holdings ($B)</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.series.ust} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#9ca3af' }} width={40} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 11 }}
                    formatter={(v) => [`$${v.toLocaleString()}B`, 'UST']} />
                  <Line type="monotone" dataKey="value" stroke="#f87171" strokeWidth={1.5} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Four pillars ─────────────────────────────────────────── */}
          {fw && (
            <div className="card overflow-x-auto">
              <div className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-200">The strategy — four pillars</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-300">
                    <th className="px-4 py-2 text-left font-medium">Pillar</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Where it stands</th>
                  </tr>
                </thead>
                <tbody>
                  {fw.pillars.map(p => (
                    <tr key={p.key} className="border-b border-gray-800/50">
                      <td className="px-4 py-2 text-gray-100 font-medium whitespace-nowrap">{p.name}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] border rounded px-1.5 py-0.5 ${PILLAR_TONE[p.tone]}`}>{p.status}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-[11px]">{p.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── What's real / limits / outlook ───────────────────────── */}
          {fw && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <List title="What's genuinely happening" items={fw.whatsReal} dot="bg-orange-500" />
              <List title="The hard limits" items={fw.hardLimits} dot="bg-red-500" />
              <List title="Realistic outlook" items={fw.outlook} dot="bg-blue-500" />
            </div>
          )}

          <p className="text-[10px] text-gray-500">
            Sources: USD/CNY from Frankfurter (ECB); PBoC gold & US Treasury holdings from official monthly
            stats / TIC; SWIFT & IMF COFER reserve shares; reporting on CIPS, mBridge and petroyuan through 2026.
            Approximate, educational reference — not investment advice.
          </p>
        </>
      )}
    </div>
  );
}
