import { Fragment, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import api from '../api/client.js';
import SignalBadge, { ScoreBar } from '../components/common/SignalBadge.jsx';
import LiveBadge from '../components/common/LiveBadge.jsx';
import Tip from '../components/common/Tip.jsx';
import MeanRevBadge, { MEAN_REV_TIP } from '../components/common/MeanRevBadge.jsx';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

const REFRESH_MS = 60_000;

const COLS = [
  { key: 'symbol',  label: 'Symbol' },
  { key: 'price',   label: 'Price' },
  { key: 'rsi',     label: 'RSI',     tip: 'Relative Strength Index — momentum oscillator 0–100. Above 70 = overbought, below 30 = oversold.' },
  { key: 'meanRev', label: 'Mean Rev', tip: MEAN_REV_TIP },
  { key: 'adx',     label: 'ADX',     tip: 'Average Directional Index — trend strength. 14+ = trending, 25+ = strong trend.' },
  { key: 'buyZone', label: 'Buy Zone' },
  { key: 'stopLoss',label: 'Stop' },
  { key: 'sellZone',label: 'Target' },
  { key: 'rr',      label: 'R:R',     tip: 'Risk-to-Reward ratio — potential gain ÷ potential loss. ≥2 is favorable.' },
  { key: 'core',    label: 'Core/6',  tip: 'Core score out of 6: RSI, MACD direction & momentum, price vs SMA 20/50, SMA 50/200 trend.' },
  { key: 'tier1',   label: '+T1/11',  tip: 'Tier-1 score out of 11 — core plus Bollinger %B, 52W range, RVOL, EMA 9/21, Stochastic.' },
  { key: 'tier2',   label: '+T2/16',  tip: 'Tier-2 score out of 16 — tier-1 plus VWAP, MACD crossover, CCI, MFI, ROC.' },
  { key: 'adxScore',label: '+ADX/17', tip: 'ADX-enhanced score out of 17 — tier-2 plus ADX trend-strength (DI+/DI−) when ADX ≥ 20.' },
  { key: 'obv',     label: '+OBV/18', tip: 'OBV-enhanced score out of 18 — ADX score plus On-Balance Volume momentum.' },
  { key: 'regime',  label: '+Rgm/19', tip: 'Regime-adjusted score out of 19 — full score including SPY bull/bear regime.' },
];

function fmt(n, d = 2) { return n != null ? n.toFixed(d) : '—'; }

// Sort rank: buy setups bubble to the top in the default (desc) order.
const MR_RANK = { entry: 3, oversold: 2, neutral: 1, overbought: 0 };

function sortBy(arr, key, dir) {
  return [...arr].sort((a, b) => {
    let av, bv;
    if (key === 'buyZone') { av = a.buyZone?.price; bv = b.buyZone?.price; }
    else if (key === 'sellZone') { av = a.sellZone?.price; bv = b.sellZone?.price; }
    else if (key === 'meanRev') { av = MR_RANK[a.meanReversion?.state]; bv = MR_RANK[b.meanReversion?.state]; }
    else if (key === 'core') { av = a.scores?.core?.score; bv = b.scores?.core?.score; }
    else if (key === 'tier1') { av = a.scores?.tier1?.score; bv = b.scores?.tier1?.score; }
    else if (key === 'tier2') { av = a.scores?.tier2?.score; bv = b.scores?.tier2?.score; }
    else if (key === 'adxScore') { av = a.scores?.adx?.score; bv = b.scores?.adx?.score; }
    else if (key === 'obv') { av = a.scores?.obv?.score; bv = b.scores?.obv?.score; }
    else if (key === 'regime') { av = a.scores?.regime?.score; bv = b.scores?.regime?.score; }
    else { av = a[key]; bv = b[key]; }
    if (av == null) return 1; if (bv == null) return -1;
    return dir === 'asc' ? av - bv : bv - av;
  });
}

function ComponentDot({ val }) {
  const color = val === 1 ? 'bg-green-500' : val === -1 ? 'bg-red-500' : 'bg-gray-700';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function ExpandedRow({ s }) {
  const c = s.components || {};
  return (
    <tr className="bg-gray-950">
      <td colSpan={16} className="px-4 py-3">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <div className="text-gray-300 font-semibold mb-1">Moving Averages</div>
            {[['SMA 20', s.sma20], ['SMA 50', s.sma50], ['SMA 200', s.sma200],
              ['EMA 9', s.ema9], ['EMA 21', s.ema21]].map(([l, v]) => (
              <div key={l} className="flex justify-between">
                <span className="text-gray-300">{l}</span>
                <span className="mono text-gray-200">{fmt(v)}</span>
              </div>
            ))}
            <div className="flex justify-between">
              <span className="text-gray-300">Bollinger %B</span>
              <span className="mono text-gray-200">{s.percentB != null ? fmt(s.percentB * 100, 0) + '%' : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">52W Range</span>
              <span className="mono text-gray-200">{s.range52Pct != null ? fmt(s.range52Pct * 100, 0) + '%' : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">RVOL (20d)</span>
              <span className="mono text-gray-200">{s.rvol != null ? fmt(s.rvol) + '×' : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Stoch %K / %D</span>
              <span className="mono text-gray-200">
                {s.stochK != null ? `${fmt(s.stochK, 0)} / ${fmt(s.stochD, 0)}` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">VWAP (60d)</span>
              <span className="mono text-gray-200">{fmt(s.vwap)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">CCI (20)</span>
              <span className={`mono ${s.cci != null && s.cci < -100 ? 'text-green-400' : s.cci > 100 ? 'text-red-400' : 'text-gray-200'}`}>
                {s.cci != null ? fmt(s.cci, 0) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">MFI (14)</span>
              <span className={`mono ${s.mfi != null && s.mfi < 20 ? 'text-green-400' : s.mfi > 80 ? 'text-red-400' : 'text-gray-200'}`}>
                {s.mfi != null ? fmt(s.mfi, 0) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">ROC (10d)</span>
              <span className={`mono ${s.roc != null && s.roc > 2 ? 'text-green-400' : s.roc < -2 ? 'text-red-400' : 'text-gray-200'}`}>
                {s.roc != null ? fmt(s.roc, 1) + '%' : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">52W High</span>
              <span className="mono text-gray-200">{fmt(s.year52High)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">52W Low</span>
              <span className="mono text-gray-200">{fmt(s.year52Low)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">DI+</span>
              <span className="mono text-green-400">{fmt(s.diPlus, 1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">DI−</span>
              <span className="mono text-red-400">{fmt(s.diMinus, 1)}</span>
            </div>
            {s.meanReversion?.buyPoint != null && (
              <>
                <div className="text-gray-300 font-semibold mt-2 mb-1">Mean Reversion</div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Buy point (−2σ)</span>
                  <span className={`mono ${s.meanReversion.at === 'buy' ? 'text-green-400 font-bold' : 'text-gray-200'}`}>
                    {fmt(s.meanReversion.buyPoint)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Mean (SMA 20)</span>
                  <span className="mono text-gray-200">{fmt(s.meanReversion.mean)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Sell point (+2σ)</span>
                  <span className={`mono ${s.meanReversion.at === 'sell' ? 'text-red-400 font-bold' : 'text-gray-200'}`}>
                    {fmt(s.meanReversion.sellPoint)}
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-gray-300 font-semibold mb-1">Component Votes</div>
            {[
              ['RSI signal',       c.rsiSig],
              ['MACD direction',   c.macdDirSig],
              ['MACD momentum',    c.macdMomSig],
              ['vs SMA 20',        c.vsSma20Sig],
              ['vs SMA 50',        c.vsSma50Sig],
              ['SMA 50/200 trend', c.smaTrendSig],
              ['Bollinger %B',     c.bbSig],
              ['52W range',        c.range52Sig],
              ['RVOL surge',       c.rvolSig],
              ['EMA 9/21 trend',   c.emaTrendSig],
              ['Stochastic',       c.stochSig],
              ['vs VWAP (60d)',    c.vwapSig],
              ['MACD crossover',   c.macdCrossSig],
              ['CCI (20)',         c.cciSig],
              ['MFI (14)',         c.mfiSig],
              ['ROC (10d)',        c.rocSig],
              ['ADX (DI±)',        c.adxSig],
              ['OBV',              c.obvSig],
              ['SPY regime',       c.regimeSig],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-gray-300">{label}</span>
                <ComponentDot val={val} />
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function SignalsView() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('regime');
  const [sortDir, setSortDir] = useState('desc');
  const [expanded, setExpanded] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/signals/watchlist');
      setSignals(r.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const { lastUpdated, secondsLeft, refreshNow } = useAutoRefresh(load, REFRESH_MS);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function toggleExpand(sym) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      return next;
    });
  }

  const sorted = sortBy(signals, sortKey, sortDir);
  const spy = sorted.find(s => s.symbol === 'SPY');

  function SortIcon({ col }) {
    if (sortKey !== col) return <ChevronRight size={10} className="opacity-20" />;
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-200">Signals</h1>
          {spy && (
            <span className={`text-xs border rounded px-2 py-0.5 ${spy.spyRegime === 'bull' ? 'border-green-600 text-green-400' : 'border-red-600 text-red-400'}`}>
              SPY {spy.spyRegime === 'bull' ? 'Bull' : 'Bear'} Regime
            </span>
          )}
        </div>
        <LiveBadge
          lastUpdated={lastUpdated}
          secondsLeft={secondsLeft}
          loading={loading}
          onRefresh={refreshNow}
          intervalSec={REFRESH_MS / 1000}
        />
      </div>

      {error && <div className="card p-3 text-red-400 text-xs">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="w-6 px-2 py-2" />
              {COLS.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-2 py-2 text-left text-gray-300 font-medium cursor-pointer hover:text-gray-200 whitespace-nowrap"
                >
                  <span className="flex items-center gap-1">
                    {col.label}{col.tip && <Tip text={col.tip} below />} <SortIcon col={col.key} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => (
              <Fragment key={s.symbol}>
                <tr
                  onClick={() => toggleExpand(s.symbol)}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                >
                  <td className="px-2 py-2 text-gray-300">
                    {expanded.has(s.symbol) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  </td>
                  <td className="px-2 py-2 font-semibold text-gray-100 whitespace-nowrap">
                    {s.symbol}
                    {s.spyRegime !== 'neutral' && (
                      <span className={`ml-1 text-[9px] border rounded px-1 ${s.spyRegime === 'bull' ? 'border-green-800 text-green-500' : 'border-red-800 text-red-500'}`}>
                        {s.spyRegime}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 mono text-gray-200">{fmt(s.price)}</td>
                  <td className={`px-2 py-2 mono ${s.rsi < 40 ? 'text-green-400' : s.rsi > 65 ? 'text-red-400' : 'text-gray-300'}`}>
                    {fmt(s.rsi, 1)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="space-y-1">
                      <MeanRevBadge mr={s.meanReversion} />
                      {s.meanReversion?.buyPoint != null && (
                        <div className="flex items-center gap-1.5 text-[9px] mono leading-none">
                          <span className={s.meanReversion.at === 'buy' ? 'text-green-400 font-bold' : 'text-gray-500'}>
                            B {fmt(s.meanReversion.buyPoint)}
                          </span>
                          <span className={s.meanReversion.at === 'sell' ? 'text-red-400 font-bold' : 'text-gray-500'}>
                            S {fmt(s.meanReversion.sellPoint)}
                          </span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className={`px-2 py-2 mono ${s.adx >= 25 ? 'text-yellow-400' : 'text-gray-300'}`}>
                    {fmt(s.adx, 1)}
                  </td>
                  <td className="px-2 py-2 text-gray-300">
                    {s.buyZone ? `$${fmt(s.buyZone.price)} ${s.buyZone.label}` : '—'}
                  </td>
                  <td className="px-2 py-2 text-red-400 mono">{fmt(s.stopLoss)}</td>
                  <td className="px-2 py-2 text-gray-300">
                    {s.sellZone ? `$${fmt(s.sellZone.price)} ${s.sellZone.label}` : '—'}
                  </td>
                  <td className={`px-2 py-2 mono ${s.rr >= 2 ? 'text-green-400' : 'text-gray-300'}`}>
                    {s.rr != null ? fmt(s.rr) : '—'}
                  </td>
                  {['core', 'tier1', 'tier2', 'adx', 'obv', 'regime'].map(k => {
                    const sc = s.scores?.[k];
                    return (
                      <td key={k} className="px-2 py-2 min-w-[80px]">
                        {sc && (
                          <div className="space-y-1">
                            <SignalBadge signal={sc.signal} score={sc.score} max={sc.max} size="xs" />
                            <ScoreBar score={sc.score} max={sc.max} />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {expanded.has(s.symbol) && <ExpandedRow s={s} />}
              </Fragment>
            ))}
          </tbody>
        </table>

        {!loading && sorted.length === 0 && (
          <div className="p-8 text-center text-gray-300 text-sm">
            Add symbols to your watchlist to see signals
          </div>
        )}
      </div>
    </div>
  );
}
