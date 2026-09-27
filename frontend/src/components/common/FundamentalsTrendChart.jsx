import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { RefreshCw } from 'lucide-react';
import api from '../../api/client.js';

const METRICS = [
  { key: 'epsTTM',       label: 'EPS',        unit: 'usd',  fmt: v => `$${v.toFixed(2)}` },
  { key: 'revTTM',       label: 'Revenue',    unit: 'usdB', fmt: v => `$${(v / 1e9).toFixed(1)}B` },
  { key: 'niTTM',        label: 'Net Income', unit: 'usdB', fmt: v => `$${(v / 1e9).toFixed(2)}B` },
  { key: 'marginPct',    label: 'Margin',     unit: 'pct',  fmt: v => `${v.toFixed(1)}%` },
  { key: 'epsGrowthPct', label: 'EPS Growth', unit: 'pct',  fmt: v => `${v.toFixed(1)}%` },
  { key: 'revGrowthPct', label: 'Rev Growth', unit: 'pct',  fmt: v => `${v.toFixed(1)}%` },
];

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#06b6d4', '#84cc16', '#f97316', '#a855f7', '#14b8a6', '#eab308',
];

function fmtDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
}
function fmtDateFull(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function FundamentalsTrendChart({ symbols }) {
  const symbolStr = symbols.join(',');

  const [raw, setRaw]         = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const [selMetrics, setSelMetrics] = useState(new Set(['epsTTM']));
  const [selSymbols, setSelSymbols] = useState(new Set());
  const [indexedPref, setIndexedPref] = useState(false);

  const fetchData = useCallback(async () => {
    if (!symbolStr) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/market/moving-average?symbols=${symbolStr}`);
      setRaw(res.data);
      // default: select all returned symbols the first time
      setSelSymbols(prev => prev.size ? prev : new Set(res.data.map(d => d.symbol)));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [symbolStr]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const availSymbols = raw?.map(d => d.symbol) ?? [];

  // Multiple metrics can't share an axis (EPS $ vs Revenue $B vs Margin %),
  // so force indexing when more than one metric is picked.
  const forceIndexed = selMetrics.size > 1;
  const indexed = forceIndexed || indexedPref;
  const singleMetric = selMetrics.size === 1 ? [...selMetrics][0] : null;
  const singleMetricDef = METRICS.find(m => m.key === singleMetric);

  const toggle = (setter, key) => setter(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // Build one line per (symbol × metric) combination.
  const { chartData, lines } = useMemo(() => {
    if (!raw) return { chartData: [], lines: [] };

    // symbol → Map(date → point)
    const bySymbol = new Map();
    for (const { symbol, series } of raw) {
      const m = new Map();
      for (const pt of series) m.set(pt.date, pt);
      bySymbol.set(symbol, m);
    }

    const lineDefs = [];
    let ci = 0;
    for (const sym of availSymbols) {
      if (!selSymbols.has(sym)) continue;
      for (const mk of selMetrics) {
        const md = METRICS.find(m => m.key === mk);
        const name = selMetrics.size > 1 && selSymbols.size > 1
          ? `${sym} · ${md.label}`
          : selMetrics.size > 1 ? md.label : sym;
        lineDefs.push({ key: `${sym}__${mk}`, sym, mk, name, color: PALETTE[ci++ % PALETTE.length] });
      }
    }

    // base value per line (first non-null), for indexing
    const allDates = new Set();
    for (const { series } of raw) for (const pt of series) allDates.add(pt.date);
    const dates = [...allDates].sort();

    const base = {};
    for (const ld of lineDefs) {
      const dmap = bySymbol.get(ld.sym);
      for (const d of dates) {
        const v = dmap?.get(d)?.[ld.mk];
        if (v != null && isFinite(v)) { base[ld.key] = v; break; }
      }
    }

    const rows = dates.map(date => {
      const row = { date };
      for (const ld of lineDefs) {
        const raw_v = bySymbol.get(ld.sym)?.get(date)?.[ld.mk];
        const v = (raw_v != null && isFinite(raw_v)) ? raw_v : null;
        if (v == null) { row[ld.key] = null; continue; }
        if (indexed) {
          const b = base[ld.key];
          row[ld.key] = (b != null && b !== 0) ? (v / b) * 100 : null;
        } else {
          row[ld.key] = v;
        }
      }
      return row;
    });

    return { chartData: rows, lines: lineDefs };
  }, [raw, selSymbols, selMetrics, indexed, availSymbols]);

  const yFmt = indexed
    ? (v => v.toFixed(0))
    : (singleMetricDef ? (v => singleMetricDef.fmt(v)) : (v => v));

  const chip = (active, onClick, label, color) => (
    <button
      key={label}
      onClick={onClick}
      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors border ${
        active
          ? 'bg-blue-600/20 border-blue-600 text-blue-300'
          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
      }`}
      style={active && color ? { borderColor: color, color } : undefined}
    >
      {label}
    </button>
  );

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">12-Month Moving-Average Trends</h2>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Rolling TTM series from SEC EDGAR filings. Pick any mix of indicators and stocks.
          </p>
        </div>
        <button onClick={fetchData} disabled={loading}
          className="btn-ghost flex items-center gap-1.5 py-1">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="text-red-400 text-xs">{error}</div>}

      {/* Metric picker */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-gray-500 w-16">Indicators</span>
        {METRICS.map(m => chip(selMetrics.has(m.key), () => toggle(setSelMetrics, m.key), m.label))}
      </div>

      {/* Symbol picker */}
      {availSymbols.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-gray-500 w-16">Stocks</span>
          {availSymbols.map((s, i) =>
            chip(selSymbols.has(s), () => toggle(setSelSymbols, s), s, PALETTE[i % PALETTE.length]))}
        </div>
      )}

      {/* Scale toggle */}
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-gray-500">Scale</span>
        <button
          onClick={() => !forceIndexed && setIndexedPref(false)}
          disabled={forceIndexed}
          className={`px-2 py-0.5 rounded ${!indexed ? 'bg-blue-600/30 text-blue-300' : 'text-gray-400 hover:text-gray-200'} ${forceIndexed ? 'opacity-40 cursor-not-allowed' : ''}`}
        >Absolute</button>
        <button
          onClick={() => setIndexedPref(true)}
          className={`px-2 py-0.5 rounded ${indexed ? 'bg-blue-600/30 text-blue-300' : 'text-gray-400 hover:text-gray-200'}`}
        >Indexed (100)</button>
        {forceIndexed && <span className="text-gray-500 italic">— indexed automatically when mixing indicators of different units</span>}
      </div>

      {loading && !raw && (
        <div className="h-72 flex items-center justify-center text-gray-500 text-sm">
          Fetching SEC EDGAR filing data…
        </div>
      )}

      {chartData.length > 0 && lines.length > 0 && (
        <ResponsiveContainer width="100%" height={380}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 11 }}
              tickFormatter={fmtDate} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={yFmt} width={58} />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#e5e7eb', marginBottom: 4 }}
              labelFormatter={fmtDateFull}
              formatter={(value, name) => {
                if (value == null) return ['—', name];
                return [indexed ? value.toFixed(1) : (singleMetricDef ? singleMetricDef.fmt(value) : value), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
              formatter={v => <span style={{ color: '#d1d5db' }}>{v}</span>} />
            {indexed && <ReferenceLine y={100} stroke="#6b7280" strokeDasharray="4 4" />}
            {!indexed && singleMetricDef?.unit === 'pct' && <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />}
            {lines.map(ld => (
              <Line key={ld.key} type="monotone" dataKey={ld.key} name={ld.name}
                stroke={ld.color} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {chartData.length > 0 && lines.length === 0 && (
        <div className="h-40 flex items-center justify-center text-gray-500 text-xs">
          Select at least one indicator and one stock.
        </div>
      )}

      {indexed && lines.length > 0 && (
        <p className="text-[10px] text-gray-500">
          Indexed to 100 at each series' first data point — compares growth trajectories across
          different units. Switch to a single indicator to see absolute values.
        </p>
      )}
    </div>
  );
}
