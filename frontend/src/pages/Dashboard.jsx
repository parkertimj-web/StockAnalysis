import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import api from '../api/client.js';
import useStore from '../store/store.js';
import SignalBadge from '../components/common/SignalBadge.jsx';
import LiveBadge from '../components/common/LiveBadge.jsx';
import Tip from '../components/common/Tip.jsx';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

const REFRESH_MS = 90_000; // 90 s — matches Stooq quote cache TTL during market hours

function fmt(n, d = 2) { return n != null ? n.toFixed(d) : '—'; }
function fmtVol(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return (n / 1e3).toFixed(0) + 'K';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const setSelectedSymbol = useStore(s => s.setSelectedSymbol);
  const watchlist    = useStore(s => s.watchlist);
  const setWatchlist = useStore(s => s.setWatchlist);

  const [signals, setSignals]   = useState({});
  const [fundMap, setFundMap]   = useState({});
  const [stats, setStats]       = useState(null);
  const [addInput, setAddInput] = useState('');
  const [loadingSignals, setLoadingSignals] = useState(false);

  function loadStats() {
    api.get('/journal/stats').then(r => setStats(r.data)).catch(() => {});
  }

  const fetchData = useCallback(async () => {
    // Watchlist fetch is fast and reliable — always do it first independently
    // so a slow/failed signals call never blanks the watchlist.
    try {
      const wl = await api.get('/watchlist');
      setWatchlist(wl.data);
    } catch { /* keep existing watchlist on error */ }

    // Signals fetch may be slow or 429 — run separately
    setLoadingSignals(true);
    try {
      const sig = await api.get('/signals/watchlist');
      const map = {};
      sig.data.forEach(s => { map[s.symbol] = s; });
      setSignals(map);
    } catch { /* keep existing signals on error */ }
    finally { setLoadingSignals(false); }

    // Fundamentals (PEG etc.) — best-effort, 4h cache, won't block other data
    try {
      const wl = watchlist; // captured in closure; may be stale on first render — that's fine
      if (wl.length) {
        const symbols = wl.map(w => w.symbol).join(',');
        const fRes = await api.get('/market/fundamentals', { params: { symbols } });
        const fm = {};
        fRes.data.forEach(f => { fm[f.symbol] = f; });
        setFundMap(fm);
      }
    } catch { /* fundamentals are optional */ }
  }, []);

  const { lastUpdated, secondsLeft, refreshNow } = useAutoRefresh(fetchData, REFRESH_MS);

  useEffect(() => { loadStats(); }, []);

  async function addSymbol(e) {
    e.preventDefault();
    const sym = addInput.trim().toUpperCase();
    if (!sym) return;
    await api.post('/watchlist', { symbol: sym });
    setAddInput('');
    refreshNow(); // re-fetch watchlist + signals together
  }

  async function removeSymbol(sym) {
    await api.delete(`/watchlist/${sym}`);
    setWatchlist(watchlist.filter(w => w.symbol !== sym));
    setSignals(prev => { const next = { ...prev }; delete next[sym]; return next; });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-200">Dashboard</h1>
          <LiveBadge
            lastUpdated={lastUpdated}
            secondsLeft={secondsLeft}
            loading={loadingSignals}
            onRefresh={refreshNow}
            intervalSec={REFRESH_MS / 1000}
          />
        </div>
        <form onSubmit={addSymbol} className="flex gap-2">
          <input
            value={addInput}
            onChange={e => setAddInput(e.target.value)}
            placeholder="Add symbol…"
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-1.5 w-28 focus:outline-none focus:border-blue-500"
          />
          <button type="submit" className="btn-primary flex items-center gap-1">
            <Plus size={12} /> Add
          </button>
        </form>
      </div>


      {/* Journal Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            ['Total P&L', `$${fmt(stats.totalPnl)}`, stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'],
            ['Win Rate',  `${fmt(stats.winRate, 1)}%`, 'text-blue-400'],
            ['Trades',    stats.closedTrades, 'text-gray-200'],
            ['Open',      stats.openTrades, 'text-yellow-400'],
          ].map(([label, val, cls]) => (
            <div key={label} className="card p-3 text-center">
              <div className="text-gray-300 text-[10px]">{label}</div>
              <div className={`text-sm font-semibold mono ${cls}`}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Watchlist cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {watchlist.map(({ symbol }) => {
          const s = signals[symbol];
          const f = fundMap[symbol];
          const price     = s?.price;
          const change    = s?.change    ?? null;
          const changePct = s?.changePct ?? null;
          const isUp      = (change ?? 0) >= 0;

          return (
            <div
              key={symbol}
              className="card p-3 cursor-pointer hover:border-gray-600 transition-colors"
              onClick={() => { setSelectedSymbol(symbol); navigate(`/chart/${symbol}`); }}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-sm font-bold text-gray-100">{symbol}</div>
                  {price != null && (
                    <div className="text-base font-semibold mono text-gray-200">${fmt(price)}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {change != null && (
                    <div className={`flex items-center gap-0.5 text-xs mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                      {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {isUp ? '+' : ''}{fmt(change)} ({fmt(changePct, 2)}%)
                    </div>
                  )}
                  {s && <SignalBadge signal={s.scores?.regime?.signal} score={s.scores?.regime?.score} max={s.scores?.regime?.max} size="xs" />}
                </div>
              </div>

              {s && (
                <div className="grid grid-cols-3 gap-1 text-[10px] text-gray-300">
                  <div>RSI<Tip text="Relative Strength Index — momentum 0–100. Above 70 = overbought, below 30 = oversold." below /> <span className="text-gray-300 mono">{fmt(s.rsi, 1)}</span></div>
                  <div>ADX<Tip text="Average Directional Index — trend strength. 14+ = trending, 25+ = strong trend." below /> <span className="text-gray-300 mono">{fmt(s.adx, 1)}</span></div>
                  <div>R:R<Tip text="Risk-to-Reward ratio — potential gain ÷ potential loss. ≥2 is favorable." below /> <span className={`mono ${s.rr >= 2 ? 'text-green-400' : 'text-gray-300'}`}>{s.rr != null ? fmt(s.rr) : '—'}</span></div>
                </div>
              )}
              {f && (
                <div className="grid grid-cols-3 gap-1 text-[10px] mt-1">
                  <div className="text-gray-300">PEG<Tip text="Price/Earnings-to-Growth — P/E ÷ EPS growth rate. Below 1 = potentially undervalued vs growth." below /> <span className={`mono font-medium ${f.pegRatio == null ? 'text-gray-300' : f.pegRatio < 1 ? 'text-green-400' : f.pegRatio < 2 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {f.pegRatio != null ? fmt(f.pegRatio) : '—'}
                  </span></div>
                  <div className="text-gray-300">P/E<Tip text="Price-to-Earnings ratio — stock price ÷ trailing 12-month EPS." below /> <span className="mono text-gray-200">{f.trailingPE != null ? fmt(f.trailingPE, 1) : '—'}</span></div>
                  <div className="text-gray-300">EPS<Tip text="Earnings Per Share — trailing 12-month net income ÷ diluted shares outstanding." below /> <span className="mono text-gray-200">{f.trailingEps != null ? `$${fmt(f.trailingEps)}` : '—'}</span></div>
                </div>
              )}

              <button
                onClick={e => { e.stopPropagation(); removeSymbol(symbol); }}
                className="mt-2 text-gray-300 hover:text-red-400 transition-colors"
                title="Remove from watchlist"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {watchlist.length === 0 && (
        <div className="card p-8 text-center text-gray-300 text-sm">
          Add symbols above to get started
        </div>
      )}
    </div>
  );
}
