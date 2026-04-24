import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import useStore from '../store/store.js';
import api from '../api/client.js';

function fmt(n, d = 2) { return n != null ? n.toFixed(d) : '—'; }

// Only Fridays, not expired, capped at 2027, grouped by year
function groupFridaysByYear(dates) {
  const now = Date.now();
  const groups = {};
  for (const d of dates) {
    if (d <= now) continue;                          // skip expired
    const date = new Date(d);
    if (date.getUTCDay() !== 5) continue;            // Fridays only
    const yr = date.getUTCFullYear();
    if (yr > 2027) continue;                         // cap at LEAPS 2027
    if (!groups[yr]) groups[yr] = [];
    groups[yr].push(d);
  }
  return Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b));
}

export default function CallsMatrixView() {
  const { symbol: paramSymbol } = useParams();
  const { selectedSymbol, setSelectedSymbol, callsMatrixPrefs, setCallsMatrixPrefs } = useStore();
  const symbol = paramSymbol || selectedSymbol;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Local state for expiries/strikes
  const [allExpiries, setAllExpiries] = useState([]);
  const [selectedExpiries, setSelectedExpiries] = useState([]);
  const [strikeMin, setStrikeMin] = useState('');
  const [strikeMax, setStrikeMax] = useState('');
  const [matrix, setMatrix] = useState(null);

  useEffect(() => {
    if (paramSymbol) setSelectedSymbol(paramSymbol);
  }, [paramSymbol]);

  useEffect(() => {
    if (!symbol) return;
    // Restore prefs if same symbol — strip any dates that have since expired
    if (callsMatrixPrefs.forSymbol === symbol) {
      const now = Date.now();
      setSelectedExpiries((callsMatrixPrefs.selectedExpiries || []).filter(d => d > now));
      setStrikeMin(callsMatrixPrefs.strikeMin || '');
      setStrikeMax(callsMatrixPrefs.strikeMax || '');
    } else {
      setSelectedExpiries([]);
      setStrikeMin('');
      setStrikeMax('');
    }
    setData(null);
    setMatrix(null);
    loadExpiries();
  }, [symbol]);

  function loadExpiries() {
    if (!symbol) return;
    setLoading(true);
    api.get(`/options/${symbol}`)
      .then(r => {
        setAllExpiries(r.data.expirationDates || []);
        setData(r.data);
      })
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }

  async function buildMatrix() {
    if (!symbol || selectedExpiries.length === 0) return;
    setLoading(true);

    // Drop any expired dates that may have lingered in state
    const now = Date.now();
    const validExpiries = selectedExpiries.filter(d => d > now);
    if (validExpiries.length === 0) { setLoading(false); return; }

    const byExpiry = {};
    for (const dateMs of validExpiries) {
      try {
        const r = await api.get(`/options/${symbol}`, { params: { date: Math.floor(dateMs / 1000) } });
        byExpiry[dateMs] = r.data.calls || [];
      } catch {}
    }

    // Collect all strikes
    let allStrikes = new Set();
    Object.values(byExpiry).forEach(calls =>
      calls.forEach(c => allStrikes.add(c.strike))
    );

    let strikes = Array.from(allStrikes).sort((a, b) => a - b);
    const minVal = strikeMin ? parseFloat(strikeMin) : null;
    const maxVal = strikeMax ? parseFloat(strikeMax) : null;
    if (minVal) strikes = strikes.filter(s => s >= minVal);
    if (maxVal) strikes = strikes.filter(s => s <= maxVal);

    setMatrix({ byExpiry, strikes, expiries: [...validExpiries].sort((a, b) => a - b) });

    // Persist prefs — only save non-expired dates
    setCallsMatrixPrefs({
      forSymbol: symbol,
      selectedExpiries: validExpiries,
      strikeMin,
      strikeMax,
    });

    setLoading(false);
  }

  function toggleExpiry(dateMs) {
    setSelectedExpiries(prev =>
      prev.includes(dateMs) ? prev.filter(d => d !== dateMs) : [...prev, dateMs]
    );
  }

  if (!symbol) return (
    <div className="card p-8 text-center text-gray-300 text-sm">Select a symbol</div>
  );

  return (
    <div className="space-y-3">

      {/* ── Sticky header: title + expiry selector ── */}
      <div className="sticky top-0 z-20 bg-gray-950 space-y-3 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-gray-200">{symbol} Calls Matrix</h1>
        </div>

        {/* Expiry selector */}
        <div className="card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-300 uppercase tracking-wide">
              Expiry Dates — Fridays only
              {selectedExpiries.length > 0 && (
                <span className="ml-1 text-blue-400">· {selectedExpiries.length} selected</span>
              )}
            </span>
            <button
              onClick={() => setSelectedExpiries([])}
              className="btn-ghost py-0.5 px-2 text-[10px]"
            >Clear</button>
          </div>

          {groupFridaysByYear(allExpiries).map(([year, dates]) => (
            <div key={year}>
              <div className="text-[10px] text-gray-300 uppercase tracking-widest mb-1">
                {year}{Number(year) >= new Date().getFullYear() + 1 ? ' · LEAPS' : ''}
              </div>
              <div className="flex flex-wrap gap-1">
                {dates.map(d => (
                  <button
                    key={d}
                    onClick={() => toggleExpiry(d)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      selectedExpiries.includes(d)
                        ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                        : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-blue-600 hover:text-gray-200'
                    }`}
                  >
                    {format(new Date(d), 'MMM d')}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="flex gap-2 items-center pt-1 border-t border-gray-800/50">
            <input
              value={strikeMin}
              onChange={e => setStrikeMin(e.target.value)}
              placeholder="Strike min"
              className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 w-24"
            />
            <span className="text-gray-300 text-xs">—</span>
            <input
              value={strikeMax}
              onChange={e => setStrikeMax(e.target.value)}
              placeholder="Strike max"
              className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 w-24"
            />
            <button onClick={buildMatrix} disabled={loading || selectedExpiries.length === 0}
              className="btn-primary">
              Build Matrix
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="card p-8 text-center text-gray-300 animate-pulse text-sm">Loading…</div>}
      {error && <div className="card p-3 text-red-400 text-xs">{error}</div>}

      {matrix && (
        <div className="card overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-3 py-2 text-left text-gray-300 sticky left-0 bg-gray-900">Strike</th>
                {matrix.expiries.map(d => (
                  <th key={d} className="px-3 py-2 text-center text-gray-300 font-medium whitespace-nowrap">
                    {format(new Date(d), 'MMM d')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.strikes.map(strike => {
                const isITM = data?.underlyingPrice && strike < data.underlyingPrice;
                return (
                  <tr key={strike} className={`border-b border-gray-800/30 ${isITM ? 'bg-blue-950/20' : ''}`}>
                    <td className={`px-3 py-1.5 mono font-medium sticky left-0 bg-gray-900 ${isITM ? 'text-blue-300' : 'text-gray-200'}`}>
                      {fmt(strike)}
                    </td>
                    {matrix.expiries.map(d => {
                      const calls = matrix.byExpiry[d] || [];
                      const c = calls.find(x => x.strike === strike);
                      return (
                        <td key={d} className="px-3 py-1.5 text-center">
                          {c ? (
                            <div className="space-y-0.5">
                              <div className="mono text-gray-200">{fmt(c.lastPrice)}</div>
                              <div className="text-gray-300 text-[10px]">
                                {c.bid != null ? `${fmt(c.bid)}/${fmt(c.ask)}` : '—'}
                              </div>
                              {c.impliedVolatility != null && (
                                <div className="text-gray-300 text-[10px]">
                                  {(c.impliedVolatility * 100).toFixed(0)}% IV
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-800">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
