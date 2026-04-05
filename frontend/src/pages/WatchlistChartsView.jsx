import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import api from '../api/client.js';
import useStore from '../store/store.js';
import LiveBadge from '../components/common/LiveBadge.jsx';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

const REFRESH_MS = 5 * 60_000; // 5 min

function fmt(n, d = 2) { return n != null ? n.toFixed(d) : '—'; }
function fmtVol(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return (n / 1e3).toFixed(0) + 'K';
}

function fmtBarDate(unixSec) {
  if (!unixSec) return null;
  return new Date(unixSec * 1000).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtFetchTime(date) {
  if (!date) return null;
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + ' — '
    + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function MiniChart({ symbol, data, fetchedAt }) {
  const chartRef = useRef(null);
  const navigate = useNavigate();
  const setSelectedSymbol = useStore(s => s.setSelectedSymbol);

  useEffect(() => {
    if (!data || !chartRef.current) return;
    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 220,
      layout: { background: { color: '#030712' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
      timeScale: { timeVisible: false, borderColor: '#1f2937' },
      rightPriceScale: { borderColor: '#1f2937', scaleMargins: { top: 0.1, bottom: 0.1 } },
      crosshair: { mode: 0 },
    });

    const cs = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    cs.setData(data.candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));

    // Current-price dashed line
    const cp = data.quote?.regularMarketPrice ?? data.candles?.[data.candles.length - 1]?.close;
    if (cp != null) {
      cs.createPriceLine({
        price: cp,
        color: '#e2e8f0',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `${cp.toFixed(2)}`,
      });
    }

    if (data.sma20) {
      const s = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, priceLineVisible: false });
      s.setData(data.sma20.map((v, i) => v !== null ? { time: data.candles[i]?.time, value: v } : null).filter(Boolean));
    }
    if (data.sma50) {
      const s = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false });
      s.setData(data.sma50.map((v, i) => v !== null ? { time: data.candles[i]?.time, value: v } : null).filter(Boolean));
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: chartRef.current?.clientWidth || 300 }));
    ro.observe(chartRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [data]);

  const q          = data?.quote || {};
  const last       = data?.candles?.[data.candles.length - 1];
  const prev       = data?.candles?.[data.candles.length - 2];
  const cp         = q.regularMarketPrice ?? last?.close;
  const prevClose  = q.previousClose ?? prev?.close;
  const chg        = cp != null && prevClose != null ? cp - prevClose : null;
  const chgPct     = chg != null && prevClose ? (chg / prevClose) * 100 : null;
  const up         = chg == null ? null : chg >= 0;

  return (
    <div
      className="card cursor-pointer hover:border-gray-600 transition-colors"
      onClick={() => { setSelectedSymbol(symbol); navigate(`/chart/${symbol}`); }}
    >
      {/* Header */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300">{symbol}</span>
        <div className="flex items-baseline gap-1.5">
          {cp != null && (
            <span className="text-sm font-bold mono text-gray-100">${fmt(cp)}</span>
          )}
          {chg != null && (
            <span className={`text-[10px] mono font-medium ${up ? 'text-green-400' : 'text-red-400'}`}>
              {up ? '+' : ''}{fmt(chg)} ({up ? '+' : ''}{fmt(chgPct)}%)
            </span>
          )}
        </div>
      </div>

      <div ref={chartRef} />

      {/* Stats footer */}
      <div className="px-3 pt-2 pb-1 border-t border-gray-800 grid grid-cols-4 gap-1 text-[9px]">
        {[
          ['Open',   fmt(q.open || last?.open)],
          ['High',   fmt(q.dayHigh || last?.high)],
          ['Low',    fmt(q.dayLow  || last?.low)],
          ['Vol',    fmtVol(q.volume)],
          ['AvgVol', fmtVol(q.avgVolume)],
          ['52W H',  fmt(q.fiftyTwoWeekHigh)],
          ['52W L',  fmt(q.fiftyTwoWeekLow)],
          ['Price',  fmt(last?.close)],
        ].map(([k, v]) => (
          <div key={k} className="text-center">
            <div className="text-gray-300">{k}</div>
            <div className="text-gray-300 mono">{v}</div>
          </div>
        ))}
      </div>

      {/* Timestamp row */}
      <div className="px-3 pb-2 flex items-center justify-between text-[9px] text-gray-300 border-t border-gray-800/40 pt-1">
        <span>
          {fmtBarDate(last?.time)
            ? <>Last bar: <span className="text-gray-300">{fmtBarDate(last.time)}</span></>
            : 'No data'}
        </span>
        {fetchedAt && (
          <span>
            Updated: <span className="text-gray-300">{fmtFetchTime(fetchedAt)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default function WatchlistChartsView() {
  const [watchlist, setWatchlist]   = useState([]);
  const [chartData, setChartData]   = useState({});   // symbol -> data
  const [fetchTimes, setFetchTimes] = useState({});   // symbol -> Date
  const [loading, setLoading]       = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const wlRes = await api.get('/watchlist');
      const wl = wlRes.data;
      setWatchlist(wl);

      // Batch 3 at a time to avoid rate-limiting
      for (let i = 0; i < wl.length; i += 3) {
        const batch = wl.slice(i, i + 3);
        await Promise.allSettled(
          batch.map(async ({ symbol }) => {
            try {
              const res = await api.get('/market/indicators', {
                params: { symbol, period: '3mo', interval: '1d' },
              });
              const now = new Date();
              setChartData(prev  => ({ ...prev,  [symbol]: res.data }));
              setFetchTimes(prev => ({ ...prev,  [symbol]: now }));
            } catch {}
          })
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const { lastUpdated, secondsLeft, refreshNow } = useAutoRefresh(fetchAll, REFRESH_MS);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-200">All Charts</h1>
          <LiveBadge
            lastUpdated={lastUpdated}
            secondsLeft={secondsLeft}
            loading={loading}
            onRefresh={refreshNow}
            intervalSec={REFRESH_MS / 1000}
          />
        </div>
        {lastUpdated && (
          <span className="text-[10px] text-gray-300 mono">
            {fmtFetchTime(lastUpdated)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {watchlist.map(({ symbol }) => (
          <MiniChart
            key={symbol}
            symbol={symbol}
            data={chartData[symbol]}
            fetchedAt={fetchTimes[symbol]}
          />
        ))}
      </div>

      {watchlist.length === 0 && (
        <div className="card p-8 text-center text-gray-300 text-sm">
          Add symbols to your watchlist first
        </div>
      )}
    </div>
  );
}
