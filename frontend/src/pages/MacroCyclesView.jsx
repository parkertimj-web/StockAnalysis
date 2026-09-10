import { useEffect, useMemo, useState } from 'react';
import {
  ScatterChart, Scatter, BarChart, Bar, Cell, XAxis, YAxis, ZAxis,
  Tooltip, ResponsiveContainer, ReferenceLine, LabelList,
} from 'recharts';
import api from '../api/client.js';
import Tip from '../components/common/Tip.jsx';

function fmt(n, d = 1) { return n != null && !isNaN(n) ? Number(n).toFixed(d) : '—'; }
function pct(n, d = 0) { return n != null && !isNaN(n) ? `${(n * 100).toFixed(d)}%` : '—'; }

function StatCard({ label, value, sub, tone = 'text-gray-100' }) {
  return (
    <div className="card p-3 text-center">
      <div className="text-gray-300 text-[10px]">{label}</div>
      <div className={`text-lg font-semibold mono ${tone}`}>{value}</div>
      {sub && <div className="text-gray-400 text-[9px] mt-0.5">{sub}</div>}
    </div>
  );
}

const REGIME_TONE = {
  hiking: 'text-red-400 border-red-800',
  cutting: 'text-green-400 border-green-800',
  holding: 'text-gray-300 border-gray-700',
};

function ScatterTip({ active, payload, xlabel }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[11px]">
      <div className="text-gray-100 font-medium">{p.name}</div>
      <div className="text-gray-300">{xlabel}: <span className="mono">{fmt(p.x)}</span></div>
      <div className="text-gray-300">Drawdown: <span className="mono text-red-400">-{fmt(p.y, 0)}%</span></div>
    </div>
  );
}

function CorrScatter({ title, data, xlabel, r, xunit }) {
  const strength = r == null ? '' :
    Math.abs(r) >= 0.6 ? 'strong' : Math.abs(r) >= 0.3 ? 'moderate' : 'weak';
  const rTone = r == null ? 'text-gray-400'
    : r > 0 ? 'text-red-400' : 'text-green-400';
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs font-medium text-gray-300">{title}</div>
        <div className={`text-[11px] mono ${rTone}`}>
          r = {r == null ? '—' : r.toFixed(2)}{r != null && <span className="text-gray-400 ml-1">({strength})</span>}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
          <XAxis type="number" dataKey="x" name={xlabel} tick={{ fontSize: 10, fill: '#9ca3af' }}
            label={{ value: `${xlabel}${xunit ? ` (${xunit})` : ''}`, position: 'bottom', offset: -2, fontSize: 10, fill: '#6b7280' }} />
          <YAxis type="number" dataKey="y" name="Drawdown" unit="%" tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <ZAxis range={[60, 60]} />
          <Tooltip content={<ScatterTip xlabel={xlabel} />} cursor={{ strokeDasharray: '3 3', stroke: '#4b5563' }} />
          <Scatter data={data} fill="#60a5fa" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MacroCyclesView() {
  const [episodes, setEpisodes] = useState([]);
  const [summary, setSummary]   = useState(null);
  const [current, setCurrent]   = useState(null);   // { live, current, conditions }
  const [manual, setManual]     = useState({ fedFunds: '', curve: '', cpiYoY: '', hySpread: '', unemployment: '', unempRising: false });
  const [manualResult, setManualResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/macro/corrections')
      .then(r => { setEpisodes(r.data.episodes); setSummary(r.data.summary); })
      .catch(e => setError(e.response?.data?.error || e.message));
    api.get('/macro/current').then(r => setCurrent(r.data)).catch(() => {});
  }, []);

  const depthData = useMemo(
    () => [...episodes].map(e => ({ ...e, depth: Math.abs(e.drawdownPct) }))
      .sort((a, b) => b.depth - a.depth),
    [episodes]
  );

  async function scoreManual(e) {
    e.preventDefault();
    try {
      const r = await api.post('/macro/score', manual);
      setManualResult(r.data);
    } catch (err) { setError(err.response?.data?.error || err.message); }
  }

  // Present-day conditions come from live FRED (if available) or manual scoring
  const cond = current?.conditions || manualResult?.conditions;
  const cur  = current?.current || manualResult?.current;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-sm font-semibold text-gray-200">Crashes &amp; Interest Rates</h1>
        <p className="text-[11px] text-gray-400 mt-1 max-w-3xl">
          Major equity corrections (~15%+ peak-to-trough) over the last century and the interest-rate
          and macro backdrop around each one. Figures are approximate historical readings taken near
          each market peak — for study and context, not precise data or investment advice.
        </p>
      </div>

      {error && <div className="card p-3 text-red-400 text-xs">{error}</div>}

      {/* ── Summary stats ─────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <StatCard label="Episodes" value={summary.count} sub="~100 yrs" />
          <StatCard label="Avg drawdown" value={`${fmt(summary.avgDrawdown, 0)}%`} tone="text-red-400"
            sub={`median ${fmt(summary.medianDrawdown, 0)}%`} />
          <StatCard label="Fed hiking into peak" value={pct(summary.pctHiking)} tone="text-red-400" />
          <StatCard label="Curve inverted first" value={pct(summary.pctInverted)} tone="text-yellow-400"
            sub="where known" />
          <StatCard label="Recession followed" value={pct(summary.pctRecession)} tone="text-orange-400" />
          <StatCard label="Avg CPI at peak" value={`${fmt(summary.avgCpi)}%`} sub={`avg FF ${fmt(summary.avgFedFunds)}%`} />
        </div>
      )}

      {/* ── Where are we now ──────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-xs font-semibold text-gray-200">Where are we now?</h2>
          <Tip below text="Scores how many classic pre-crash conditions are present today. Educational pattern-matching against history — not a forecast." />
          {current && (
            <span className={`text-[10px] border rounded px-1.5 py-0.5 ${current.live ? 'border-green-800 text-green-400' : 'border-gray-700 text-gray-400'}`}>
              {current.live ? `live · FRED · as of ${current.current?.asOf}` : 'manual entry'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Conditions checklist / gauge */}
          <div>
            {cond ? (
              <>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className={`text-2xl font-bold mono ${cond.flags >= 4 ? 'text-red-400' : cond.flags >= 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {cond.flags}/{cond.scored}
                  </span>
                  <span className="text-[11px] text-gray-400">pre-crash conditions present</span>
                </div>
                <div className="space-y-1">
                  {cond.checks.map(c => (
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
                {summary && (
                  <div className="text-[10px] text-gray-500 mt-2 border-t border-gray-800 pt-2">
                    History: {pct(summary.pctHiking)} of crashes came amid Fed hiking, {pct(summary.pctInverted)} after a curve inversion,
                    and {pct(summary.pctRecession)} were followed by recession.
                  </div>
                )}
              </>
            ) : (
              <div className="text-[11px] text-gray-400">
                No live data yet. Add a <span className="mono text-gray-300">FRED_API_KEY</span> to
                <span className="mono text-gray-300"> backend/.env</span> for an automatic live snapshot,
                or enter today's readings on the right to score the current setup.
              </div>
            )}
          </div>

          {/* Manual entry (offline / override) */}
          {(!current || !current.live) && (
            <form onSubmit={scoreManual} className="space-y-2">
              <div className="text-[10px] text-gray-400 mb-1">Enter current readings to score today's setup:</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Fed funds %', 'fedFunds', '4.33'],
                  ['10y–2y curve %', 'curve', '0.55'],
                  ['CPI YoY %', 'cpiYoY', '3.0'],
                  ['HY OAS %', 'hySpread', '3.2'],
                  ['Unemployment %', 'unemployment', '4.2'],
                ].map(([label, name, ph]) => (
                  <div key={name}>
                    <label className="text-[9px] text-gray-400 block mb-0.5">{label}</label>
                    <input
                      type="number" step="any" placeholder={ph}
                      value={manual[name]}
                      onChange={e => setManual(m => ({ ...m, [name]: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                ))}
                <label className="flex items-center gap-1.5 text-[10px] text-gray-300 mt-4">
                  <input type="checkbox" checked={manual.unempRising}
                    onChange={e => setManual(m => ({ ...m, unempRising: e.target.checked }))} />
                  Unemployment rising
                </label>
              </div>
              <button type="submit" className="btn-primary text-xs">Score setup</button>
            </form>
          )}
        </div>
      </div>

      {/* ── Correlations ──────────────────────────────────────────────── */}
      {summary && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-xs font-semibold text-gray-200">Correlations with drawdown depth</h2>
            <Tip below text="Pearson correlation between each macro reading at the peak and how deep the crash went. n≈18 episodes — descriptive only, not statistically robust." />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <CorrScatter title="Fed funds vs depth" xlabel="Fed funds" xunit="%"
              data={summary.scatter.fedFundsVsDepth} r={summary.corr.fedFundsVsDepth} />
            <CorrScatter title="CPI at peak vs depth" xlabel="CPI YoY" xunit="%"
              data={summary.scatter.cpiVsDepth} r={summary.corr.cpiVsDepth} />
            <CorrScatter title="10y yield vs depth" xlabel="10y yield" xunit="%"
              data={summary.scatter.tenYearVsDepth} r={summary.corr.tenYearVsDepth} />
          </div>
        </div>
      )}

      {/* ── Drawdown depth bar chart ──────────────────────────────────── */}
      {depthData.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-medium text-gray-300 mb-3">Drawdown depth by episode</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={depthData} margin={{ top: 6, right: 10, bottom: 60, left: 0 }}>
              <XAxis dataKey="id" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 9, fill: '#9ca3af' }} height={60} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} unit="%" />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 11 }}
                formatter={(v) => [`-${v}%`, 'Drawdown']}
                labelFormatter={(id) => depthData.find(e => e.id === id)?.name || id}
              />
              <ReferenceLine y={20} stroke="#4b5563" strokeDasharray="3 3" label={{ value: 'bear (-20%)', fontSize: 9, fill: '#6b7280', position: 'right' }} />
              <Bar dataKey="depth" radius={[2, 2, 0, 0]}>
                {depthData.map(e => (
                  <Cell key={e.id} fill={e.rateRegime === 'hiking' ? '#ef4444' : e.rateRegime === 'cutting' ? '#22c55e' : '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-[10px] text-gray-400 mt-1 justify-center">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Fed hiking</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Fed cutting</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" /> Holding</span>
          </div>
        </div>
      )}

      {/* ── Full episode table ────────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-gray-800 text-gray-300">
              {[
                ['Episode', ''], ['Peak', ''], ['Trough', ''], ['Drawdown', ''],
                ['Regime', 'Fed stance heading into the peak'],
                ['Fed funds', 'Policy rate near the peak (n/a pre-1954)'],
                ['10y', '10-year Treasury yield'],
                ['Curve inv.', 'Was the yield curve inverted beforehand?'],
                ['CPI YoY', 'Inflation near the peak'],
                ['Unemp.', 'Unemployment rate near the peak'],
                ['Recession', 'Did a recession follow?'],
                ['Trigger', ''],
              ].map(([h, tip]) => (
                <th key={h} className="px-2.5 py-2 text-left font-medium">
                  <span className="inline-flex items-center gap-0.5">{h}{tip && <Tip below text={tip} />}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {episodes.map(e => (
              <tr key={e.id} className="border-b border-gray-800/50 hover:bg-gray-800/30" title={e.notes}>
                <td className="px-2.5 py-2 font-medium text-gray-100">{e.name}</td>
                <td className="px-2.5 py-2 text-gray-400 mono">{e.peak}</td>
                <td className="px-2.5 py-2 text-gray-400 mono">{e.trough}</td>
                <td className="px-2.5 py-2 mono text-red-400 font-medium">{e.drawdownPct}%</td>
                <td className="px-2.5 py-2">
                  <span className={`text-[10px] border rounded px-1.5 py-0.5 ${REGIME_TONE[e.rateRegime]}`}>{e.rateRegime}</span>
                </td>
                <td className="px-2.5 py-2 mono text-gray-200">{e.fedFunds != null ? `${fmt(e.fedFunds)}%` : 'n/a'}</td>
                <td className="px-2.5 py-2 mono text-gray-200">{e.tenYear != null ? `${fmt(e.tenYear)}%` : '—'}</td>
                <td className="px-2.5 py-2">
                  {e.curveInverted == null
                    ? <span className="text-gray-500">?</span>
                    : e.curveInverted
                      ? <span className="text-yellow-400">Yes</span>
                      : <span className="text-gray-400">No</span>}
                </td>
                <td className={`px-2.5 py-2 mono ${e.cpiYoY >= 4 ? 'text-orange-400' : 'text-gray-200'}`}>{fmt(e.cpiYoY)}%</td>
                <td className="px-2.5 py-2 mono text-gray-200">{fmt(e.unemployment)}%</td>
                <td className="px-2.5 py-2">
                  {e.recessionFollowed
                    ? <span className="text-orange-400">Yes</span>
                    : <span className="text-gray-400">No</span>}
                </td>
                <td className="px-2.5 py-2 text-gray-400 text-[11px] whitespace-normal max-w-[220px]">{e.trigger}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-gray-500">
        Sources: approximate readings compiled from Federal Reserve (FRED), BLS and market history.
        Educational reference only — not investment advice.
      </p>
    </div>
  );
}
