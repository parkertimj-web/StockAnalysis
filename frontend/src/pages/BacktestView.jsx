import { useState } from 'react';
import { Play, ChevronDown, ChevronUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import api from '../api/client.js';

function fmt(n, d = 2) { return n != null ? n.toFixed(d) : '—'; }

export default function BacktestView() {
  const [form, setForm] = useState({
    symbol: '', period: '2y',
    rsiOversold: 40, rsiOverbought: 65, rsiPeriod: 14,
    smaPeriod: 50, requireAboveSMA: true,
    atrMultiplierStop: 2, atrMultiplierTarget: 4,
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showTrades, setShowTrades] = useState(false);

  async function run(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post('/backtest/run', form);
      setResult(r.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  const s = result?.stats;

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold text-gray-200">Backtest</h1>

      {/* Config form */}
      <div className="card p-4">
        <form onSubmit={run} className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Symbol',      'symbol',      'text',   'AAPL'],
              ['RSI Oversold','rsiOversold',  'number', '40'],
              ['RSI OB',      'rsiOverbought','number', '65'],
              ['RSI Period',  'rsiPeriod',    'number', '14'],
              ['SMA Period',  'smaPeriod',    'number', '50'],
              ['ATR Stop ×',  'atrMultiplierStop',  'number', '2'],
              ['ATR Target ×','atrMultiplierTarget', 'number', '4'],
            ].map(([label, name, type, ph]) => (
              <div key={name}>
                <label className="text-[10px] text-gray-300 mb-1 block">{label}</label>
                <input
                  required={name === 'symbol'}
                  type={type}
                  value={form[name]}
                  onChange={e => setForm(f => ({ ...f, [name]: type === 'number' ? parseFloat(e.target.value) : e.target.value }))}
                  placeholder={ph}
                  step={type === 'number' ? 'any' : undefined}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
            <div>
              <label className="text-[10px] text-gray-300 mb-1 block">Period</label>
              <select value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2 py-1.5">
                {['6mo', '1y', '2y', '3y', '5y'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="reqSMA"
              checked={form.requireAboveSMA}
              onChange={e => setForm(f => ({ ...f, requireAboveSMA: e.target.checked }))}
              className="rounded border-gray-700"
            />
            <label htmlFor="reqSMA" className="text-xs text-gray-300">Require price above SMA</label>
          </div>

          <button type="submit" disabled={loading}
            className="btn-primary flex items-center gap-1">
            <Play size={12} />
            {loading ? 'Running…' : 'Run Backtest'}
          </button>
        </form>
      </div>

      {error && <div className="card p-3 text-red-400 text-xs">{error}</div>}

      {s && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              ['Trades',     s.totalTrades, 'text-gray-200'],
              ['Win Rate',   `${fmt(s.winRate, 1)}%`, s.winRate >= 50 ? 'text-green-400' : 'text-red-400'],
              ['Total P&L',  `${fmt(s.totalPnlPct)}%`, s.totalPnlPct >= 0 ? 'text-green-400' : 'text-red-400'],
              ['Expectancy', `${fmt(s.expectancyPct)}%`, s.expectancyPct >= 0 ? 'text-green-400' : 'text-red-400'],
              ['Avg Win',    `${fmt(s.avgWinPct)}%`,  'text-green-400'],
              ['Avg Loss',   `${fmt(s.avgLossPct)}%`, 'text-red-400'],
              ['Best',       `${fmt(s.largestWin)}%`, 'text-green-400'],
              ['Worst',      `${fmt(s.largestLoss)}%`, 'text-red-400'],
            ].map(([label, val, cls]) => (
              <div key={label} className="card p-3 text-center">
                <div className="text-gray-300 text-[10px]">{label}</div>
                <div className={`text-sm font-semibold mono ${cls}`}>{val}</div>
              </div>
            ))}
          </div>

          {/* Trade P&L chart */}
          {result.trades?.length > 0 && (
            <div className="card p-4">
              <div className="text-xs font-medium text-gray-300 mb-3">Trade P&L (%)</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={result.trades} barSize={4}>
                  <XAxis dataKey="entryDate" hide />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 11 }}
                    formatter={(v) => [`${v.toFixed(2)}%`, 'P&L']}
                  />
                  <Bar dataKey="pnlPct">
                    {result.trades.map((t, i) => (
                      <Cell key={i} fill={t.pnlPct >= 0 ? '#22c55e' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Trades list */}
          <div>
            <button
              onClick={() => setShowTrades(v => !v)}
              className="btn-ghost flex items-center gap-1 mb-2">
              {showTrades ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showTrades ? 'Hide' : 'Show'} all trades ({result.trades?.length})
            </button>

            {showTrades && (
              <div className="card overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Entry', 'Exit', 'Entry $', 'Exit $', 'P&L%', 'Reason', 'Bars'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-gray-300 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} className="border-b border-gray-800/30">
                        <td className="px-3 py-1.5 text-gray-300">{new Date(t.entryDate * 1000).toLocaleDateString()}</td>
                        <td className="px-3 py-1.5 text-gray-300">{new Date(t.exitDate * 1000).toLocaleDateString()}</td>
                        <td className="px-3 py-1.5 mono text-gray-300">{fmt(t.entryPrice)}</td>
                        <td className="px-3 py-1.5 mono text-gray-300">{fmt(t.exitPrice)}</td>
                        <td className={`px-3 py-1.5 mono font-medium ${t.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {t.pnlPct >= 0 ? '+' : ''}{fmt(t.pnlPct)}%
                        </td>
                        <td className="px-3 py-1.5 text-gray-300">{t.exitReason}</td>
                        <td className="px-3 py-1.5 mono text-gray-300">{t.bars}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {result && !s && (
        <div className="card p-6 text-center text-gray-300 text-sm">
          No trades generated with these parameters
        </div>
      )}
    </div>
  );
}
