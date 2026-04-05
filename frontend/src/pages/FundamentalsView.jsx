import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import useStore from '../store/store.js';
import api from '../api/client.js';

function fmt(n, d = 2) {
  return n != null && !isNaN(n) ? Number(n).toFixed(d) : '—';
}
function fmtCap(n) {
  if (n == null) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  return n.toLocaleString();
}
function fmtPct(n) {
  if (n == null) return '—';
  return (n * 100).toFixed(1) + '%';
}

function pegColor(v) {
  if (v == null) return 'text-gray-300';
  if (v < 1)    return 'text-green-400';
  if (v < 2)    return 'text-yellow-400';
  return 'text-red-400';
}
function growthColor(v) {
  if (v == null) return 'text-gray-300';
  return v >= 0 ? 'text-green-400' : 'text-red-400';
}
function peColor(v) {
  if (v == null) return 'text-gray-300';
  if (v < 0)    return 'text-red-400';
  if (v < 20)   return 'text-green-400';
  if (v < 35)   return 'text-yellow-400';
  return 'text-red-400';
}

const COLS = [
  { key: 'symbol',                label: 'Symbol',     align: 'left'  },
  { key: 'pegRatio',              label: 'PEG',        align: 'right', tip: 'PEG = P/E ÷ EPS growth. Under 1 = potentially undervalued vs growth.' },
  { key: 'trailingPE',            label: 'P/E (ttm)',  align: 'right', tip: 'Trailing 12-month price-to-earnings ratio' },
  { key: 'forwardPE',             label: 'Fwd P/E',    align: 'right', tip: 'Forward P/E based on next-12-month estimated earnings' },
  { key: 'priceToBook',           label: 'P/B',        align: 'right', tip: 'Price-to-book ratio' },
  { key: 'evToEbitda',            label: 'EV/EBITDA',  align: 'right', tip: 'Enterprise value to EBITDA' },
  { key: 'trailingEps',           label: 'EPS (ttm)',  align: 'right', tip: 'Trailing 12-month earnings per share' },
  { key: 'forwardEps',            label: 'Fwd EPS',    align: 'right', tip: 'Estimated forward EPS' },
  { key: 'earningsGrowth',        label: 'EPS Grwth',  align: 'right', tip: 'Annual earnings growth rate' },
  { key: 'revenueGrowth',         label: 'Rev Grwth',  align: 'right', tip: 'Annual revenue growth rate' },
  { key: 'profitMargin',          label: 'Margin',     align: 'right', tip: 'Net profit margin' },
  { key: 'returnOnEquity',        label: 'ROE',        align: 'right', tip: 'Return on equity' },
  { key: 'debtToEquity',          label: 'D/E',        align: 'right', tip: 'Debt-to-equity ratio (lower = less leveraged)' },
  { key: 'marketCap',             label: 'Ent. Value', align: 'right', tip: 'Enterprise value (market cap + debt − cash)' },
];

export default function FundamentalsView() {
  const watchlist = useStore(s => s.watchlist);

  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [sortKey, setSortKey]     = useState('pegRatio');
  const [sortDir, setSortDir]     = useState('asc');
  const [tooltip, setTooltip]     = useState(null);

  const inFlight = useRef(false);

  async function load() {
    if (!watchlist.length || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const symbols = watchlist.map(w => w.symbol).join(',');
      const r = await api.get('/market/fundamentals', { params: { symbols } });
      setRows(r.data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  // Load on mount and whenever the watchlist changes
  const prevWatchlistRef = useRef(null);
  useEffect(() => {
    const key = watchlist.map(w => w.symbol).join(',');
    if (key !== prevWatchlistRef.current) {
      prevWatchlistRef.current = key;
      if (watchlist.length) load();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist]);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  function cellValue(row, key) {
    const v = row[key];
    if (key === 'symbol')          return <span className="font-semibold text-gray-100">{v}</span>;
    if (key === 'pegRatio')        return <span className={`mono font-semibold ${pegColor(v)}`}>{fmt(v)}</span>;
    if (key === 'trailingPE')      return <span className={`mono ${peColor(v)}`}>{fmt(v, 1)}</span>;
    if (key === 'forwardPE')       return <span className={`mono ${peColor(v)}`}>{fmt(v, 1)}</span>;
    if (key === 'priceToBook')     return <span className="mono text-gray-200">{fmt(v, 1)}</span>;
    if (key === 'evToEbitda')      return <span className="mono text-gray-200">{fmt(v, 1)}</span>;
    if (key === 'trailingEps')     return <span className={`mono ${v != null && v < 0 ? 'text-red-400' : 'text-gray-200'}`}>${fmt(v)}</span>;
    if (key === 'forwardEps')      return <span className={`mono ${v != null && v < 0 ? 'text-red-400' : 'text-gray-200'}`}>${fmt(v)}</span>;
    if (key === 'earningsGrowth')  return <span className={`mono ${growthColor(v)}`}>{fmtPct(v)}</span>;
    if (key === 'revenueGrowth')   return <span className={`mono ${growthColor(v)}`}>{fmtPct(v)}</span>;
    if (key === 'profitMargin')    return <span className={`mono ${growthColor(v)}`}>{fmtPct(v)}</span>;
    if (key === 'returnOnEquity')  return <span className={`mono ${growthColor(v)}`}>{fmtPct(v)}</span>;
    if (key === 'debtToEquity')    return <span className={`mono ${v != null && v > 200 ? 'text-red-400' : v != null && v < 50 ? 'text-green-400' : 'text-gray-200'}`}>{fmt(v, 0)}</span>;
    if (key === 'marketCap')       return <span className="mono text-gray-200">{fmtCap(v)}</span>;
    return <span className="mono text-gray-200">{fmt(v)}</span>;
  }

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-200">Fundamentals</h1>
        <div className="flex items-center gap-3">
          {lastUpdated && !loading && (
            <span className="text-[10px] text-gray-300">
              Updated {formatDistanceToNowStrict(lastUpdated, { addSuffix: true })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading || !watchlist.length}
            className="btn-ghost flex items-center gap-1.5 py-1"
            title="Refresh fundamentals"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="card p-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-gray-300">
        <span><span className="text-green-400 font-semibold">PEG &lt; 1</span> — undervalued vs growth</span>
        <span><span className="text-yellow-400 font-semibold">PEG 1–2</span> — fairly valued</span>
        <span><span className="text-red-400 font-semibold">PEG &gt; 2</span> — expensive vs growth</span>
        <span className="ml-auto text-gray-300 italic">Hover column headers for definitions · data cached ~30 days</span>
      </div>

      {error && <div className="card p-3 text-red-400 text-xs">{error}</div>}

      {watchlist.length === 0 && (
        <div className="card p-8 text-center text-gray-300 text-sm">
          Add symbols to your watchlist first
        </div>
      )}

      {watchlist.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    onMouseEnter={() => col.tip && setTooltip({ key: col.key, tip: col.tip })}
                    onMouseLeave={() => setTooltip(null)}
                    className={`px-2 py-2 font-medium text-gray-300 cursor-pointer hover:text-gray-200 whitespace-nowrap select-none relative ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    <span className={`flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                      {col.align === 'right' && sortKey === col.key && (
                        <span className="text-blue-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                      {col.label}
                      {col.tip && <span className="text-gray-300 text-[9px]">ⓘ</span>}
                      {col.align === 'left' && sortKey === col.key && (
                        <span className="text-blue-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </span>
                    {tooltip?.key === col.key && (
                      <div className="absolute top-full left-0 z-50 mt-1 w-52 bg-gray-800 border border-gray-700 rounded p-2 text-[10px] text-gray-200 shadow-lg whitespace-normal text-left pointer-events-none">
                        {tooltip.tip}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLS.length} className="px-3 py-8 text-center text-gray-300 animate-pulse">
                    Loading fundamentals…
                  </td>
                </tr>
              )}
              {sorted.map(row => (
                <tr key={row.symbol} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                  {COLS.map(col => (
                    <td key={col.key} className={`px-2 py-2 ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                      {cellValue(row, col.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && sorted.length === 0 && watchlist.length > 0 && (
            <div className="p-6 text-center text-gray-300 text-xs">
              No data — click <strong>Refresh</strong> to load
            </div>
          )}
        </div>
      )}

      {/* PEG explanation */}
      <div className="card p-3 text-[10px] text-gray-300 space-y-1">
        <div className="font-semibold text-gray-200 text-xs mb-1">About PEG Ratio</div>
        <p>
          <span className="text-gray-200">PEG = P/E ÷ Earnings Growth Rate.</span>{' '}
          A PEG below 1 suggests the stock may be undervalued relative to its earnings growth.
          A PEG of 1 is considered fairly valued. Above 2 is generally considered expensive.
        </p>
        <p className="text-gray-300">
          PEG is most useful for growth stocks and loses meaning when earnings or growth are negative.
          Use alongside P/E, margins, and debt levels for a complete picture.
        </p>
      </div>
    </div>
  );
}
