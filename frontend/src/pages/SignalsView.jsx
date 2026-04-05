import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import api from '../api/client.js';
import SignalBadge, { ScoreBar } from '../components/common/SignalBadge.jsx';
import LiveBadge from '../components/common/LiveBadge.jsx';
import Tip from '../components/common/Tip.jsx';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

const REFRESH_MS = 60_000;

const COLS = [
  { key: 'symbol',  label: 'Symbol' },
  { key: 'price',   label: 'Price' },
  { key: 'rsi',     label: 'RSI',     tip: 'Relative Strength Index — momentum oscillator 0–100. Above 70 = overbought, below 30 = oversold.' },
  { key: 'adx',     label: 'ADX',     tip: 'Average Directional Index — trend strength. 14+ = trending, 25+ = strong trend.' },
  { key: 'buyZone', label: 'Buy Zone' },
  { key: 'stopLoss',label: 'Stop' },
  { key: 'sellZone',label: 'Target' },
  { key: 'rr',      label: 'R:R',     tip: 'Risk-to-Reward ratio — potential gain ÷ potential loss. ≥2 is favorable.' },
  { key: 'base',    label: 'Base/6',  tip: 'Base signal score out of 6: RSI, MACD direction & momentum, price vs SMA 20/50, SMA trend.' },
  { key: 'adxScore',label: '+ADX/7',  tip: 'ADX-enhanced score out of 7 — base score plus ADX trend-strength components (DI+/DI−).' },
  { key: 'obv',     label: '+OBV/8',  tip: 'OBV-enhanced score out of 8 — ADX score plus On-Balance Volume momentum confirmation.' },
  { key: 'regime',  label: '+Rgm/9',  tip: 'Regime-adjusted score out of 9 — full score including SPY market regime (bull/bear/neutral).' },
];

function fmt(n, d = 2) { return n != null ? n.toFixed(d) : '—'; }

function sortBy(arr, key, dir) {
  return [...arr].sort((a, b) => {
    let av, bv;
    if (key === 'buyZone') { av = a.buyZone?.price; bv = b.buyZone?.price; }
    else if (key === 'sellZone') { av = a.sellZone?.price; bv = b.sellZone?.price; }
    else if (key === 'base') { av = a.scores?.base?.score; bv = b.scores?.base?.score; }
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
      <td colSpan={12} className="px-4 py-3">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <div className="text-gray-300 font-semibold mb-1">Moving Averages</div>
            {[['SMA 20', s.sma20], ['SMA 50', s.sma50], ['SMA 200', s.sma200]].map(([l, v]) => (
              <div key={l} className="flex justify-between">
                <span className="text-gray-300">{l}</span>
                <span className="mono text-gray-200">{fmt(v)}</span>
              </div>
            ))}
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
              <>
                <tr
                  key={s.symbol}
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
                  {['base', 'adx', 'obv', 'regime'].map(k => {
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
                {expanded.has(s.symbol) && <ExpandedRow key={`${s.symbol}-exp`} s={s} />}
              </>
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
