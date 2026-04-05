import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { RefreshCw } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import useStore from '../store/store.js';
import api from '../api/client.js';
import Tip from '../components/common/Tip.jsx';

const METRICS = [
  {
    key: 'epsTTM',
    label: 'EPS (TTM)',
    yFmt: v => `$${v.toFixed(2)}`,
    tickFmt: v => `$${v.toFixed(2)}`,
    description: 'Trailing 12-month diluted EPS — rolling 4-quarter sum',
  },
  {
    key: 'revTTM',
    label: 'Revenue (TTM)',
    yFmt: v => `$${(v / 1e9).toFixed(1)}B`,
    tickFmt: v => `${(v / 1e9).toFixed(0)}B`,
    description: 'Trailing 12-month revenue — rolling 4-quarter sum',
  },
  {
    key: 'niTTM',
    label: 'Net Income (TTM)',
    yFmt: v => `$${(v / 1e9).toFixed(2)}B`,
    tickFmt: v => `${(v / 1e9).toFixed(1)}B`,
    description: 'Trailing 12-month net income — rolling 4-quarter sum',
  },
  {
    key: 'marginPct',
    label: 'Profit Margin',
    yFmt: v => `${v.toFixed(1)}%`,
    tickFmt: v => `${v.toFixed(0)}%`,
    description: 'TTM net income ÷ TTM revenue',
    isPercent: true,
  },
  {
    key: 'epsGrowthPct',
    label: 'EPS Growth YoY',
    yFmt: v => `${v.toFixed(1)}%`,
    tickFmt: v => `${v.toFixed(0)}%`,
    description: 'Year-over-year change in TTM EPS',
    isPercent: true,
  },
  {
    key: 'revGrowthPct',
    label: 'Revenue Growth YoY',
    yFmt: v => `${v.toFixed(1)}%`,
    tickFmt: v => `${v.toFixed(0)}%`,
    description: 'Year-over-year change in TTM revenue',
    isPercent: true,
  },
];

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
  '#f97316', '#a855f7',
];

function fmtDate(d) {
  // d is 'YYYY-MM-DD' from SEC EDGAR
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
}

function fmtDateFull(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function MovingAvgView() {
  const watchlist     = useStore(s => s.watchlist);
  const [raw, setRaw]             = useState(null);   // API response
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [metric, setMetric]       = useState(METRICS[0]);

  // Exclude SPY — it's an ETF without standard GAAP filings
  const symbolStr = watchlist.map(w => w.symbol).filter(s => s !== 'SPY').join(',');

  const fetchData = useCallback(async () => {
    if (!symbolStr) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/market/moving-average?symbols=${symbolStr}`);
      setRaw(res.data);
      setLastFetched(new Date());
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [symbolStr]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Merge per-symbol series into Recharts format: [{ date, AAPL: v, TSLA: v, ... }]
  const chartData = (() => {
    if (!raw) return [];
    const dateMap = new Map();
    for (const { symbol, series } of raw) {
      for (const pt of series) {
        const entry = dateMap.get(pt.date) || { date: pt.date };
        const v = pt[metric.key];
        entry[symbol] = (v != null && isFinite(v)) ? v : null;
        dateMap.set(pt.date, entry);
      }
    }
    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  })();

  const symbolsInData = raw?.map(d => d.symbol) ?? [];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">12-Month Moving Average</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Rolling TTM trends from SEC EDGAR 10-Q filings
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && (
            <span className="text-xs text-gray-500">
              Updated {formatDistanceToNowStrict(lastFetched)} ago
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs text-white transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Metric tabs */}
      <div className="flex flex-wrap gap-2">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              metric.key === m.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 rounded-lg p-3">{error}</div>
      )}

      {loading && !raw && (
        <div className="flex items-center justify-center h-72 text-gray-500 text-sm">
          Fetching SEC EDGAR filing data…
        </div>
      )}

      {chartData.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">{metric.label}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{metric.description}</p>
            </div>
            {loading && (
              <RefreshCw size={13} className="animate-spin text-gray-500 mt-1" />
            )}
          </div>

          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                tickFormatter={fmtDate}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                tickFormatter={metric.tickFmt}
                width={62}
              />
              <Tooltip
                contentStyle={{
                  background: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#e5e7eb', marginBottom: '4px' }}
                labelFormatter={fmtDateFull}
                formatter={(value, name) => {
                  if (value == null) return ['—', name];
                  return [metric.yFmt(value), name];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }}
                formatter={v => <span style={{ color: '#d1d5db' }}>{v}</span>}
              />
              {metric.isPercent && (
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
              )}
              {symbolsInData.map((sym, i) => (
                <Line
                  key={sym}
                  type="monotone"
                  dataKey={sym}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Data table — current TTM snapshot for all symbols */}
      {raw && raw.length > 0 && (
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700">
            <h2 className="text-sm font-semibold text-white">Latest TTM Snapshot</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="px-4 py-2 text-left">Symbol</th>
                  <th className="px-4 py-2 text-right">EPS TTM<Tip text="Earnings Per Share — rolling 4-quarter (12-month) sum of diluted EPS." below /></th>
                  <th className="px-4 py-2 text-right">EPS Grwth<Tip text="EPS Growth YoY — year-over-year change in TTM earnings per share." below /></th>
                  <th className="px-4 py-2 text-right">Revenue TTM<Tip text="Trailing 12-month revenue — rolling 4-quarter sum from SEC EDGAR 10-Q filings." below /></th>
                  <th className="px-4 py-2 text-right">Rev Grwth<Tip text="Revenue Growth YoY — year-over-year change in TTM revenue." below /></th>
                  <th className="px-4 py-2 text-right">Net Income TTM<Tip text="Trailing 12-month net income — rolling 4-quarter sum." below /></th>
                  <th className="px-4 py-2 text-right">Margin<Tip text="Profit Margin — TTM net income ÷ TTM revenue × 100." below /></th>
                </tr>
              </thead>
              <tbody>
                {raw.map(({ symbol, series }, i) => {
                  const latest = series[series.length - 1];
                  if (!latest) return null;
                  const color = COLORS[i % COLORS.length];
                  const gc = v => v == null ? 'text-gray-400' : v >= 0 ? 'text-green-400' : 'text-red-400';
                  return (
                    <tr key={symbol} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="px-4 py-2.5 font-semibold" style={{ color }}>
                        {symbol}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-200">
                        {latest.epsTTM != null ? `$${latest.epsTTM.toFixed(2)}` : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-right ${gc(latest.epsGrowthPct)}`}>
                        {latest.epsGrowthPct != null ? `${latest.epsGrowthPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-200">
                        {latest.revTTM != null ? `$${(latest.revTTM / 1e9).toFixed(1)}B` : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-right ${gc(latest.revGrowthPct)}`}>
                        {latest.revGrowthPct != null ? `${latest.revGrowthPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-200">
                        {latest.niTTM != null ? `$${(latest.niTTM / 1e9).toFixed(2)}B` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-200">
                        {latest.marginPct != null ? `${latest.marginPct.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
