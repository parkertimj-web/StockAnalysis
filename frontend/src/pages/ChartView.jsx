import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import useStore from '../store/store.js';
import api from '../api/client.js';
import LiveBadge from '../components/common/LiveBadge.jsx';
import Tip from '../components/common/Tip.jsx';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

const REFRESH_MS = 5 * 60_000; // 5 min — chart history is heavy

const PERIODS = ['1mo', '3mo', '6mo', '1y', '2y'];
const INTERVALS = ['1d', '1wk'];
const OVERLAY_LABELS = {
  sma20: 'SMA 20', sma50: 'SMA 50', sma200: 'SMA 200',
  ema9: 'EMA 9', ema21: 'EMA 21', vwap: 'VWAP', bb: 'BB',
};
const OVERLAY_TIPS = {
  sma20:  'Simple Moving Average (20-day) — average of last 20 closing prices. Short-term trend.',
  sma50:  'Simple Moving Average (50-day) — medium-term trend indicator.',
  sma200: 'Simple Moving Average (200-day) — long-term trend benchmark. Price above = bullish.',
  ema9:   'Exponential Moving Average (9-day) — short-term momentum, weights recent prices more heavily.',
  ema21:  'Exponential Moving Average (21-day) — short-term trend, smoother than EMA 9.',
  vwap:   'Volume Weighted Average Price — average price weighted by volume. Key intraday reference level.',
  bb:     'Bollinger Bands — volatility bands ±2 standard deviations from the 20-day SMA.',
};
const OVERLAY_COLORS = {
  sma20: '#3b82f6', sma50: '#f59e0b', sma200: '#ef4444',
  ema9: '#a78bfa', ema21: '#34d399', vwap: '#f472b6', bb: '#64748b',
};

function fmt(n, dec = 2) {
  if (n == null) return '—';
  return typeof n === 'number' ? n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : n;
}
function fmtVol(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toString();
}

export default function ChartView() {
  const { symbol: paramSymbol } = useParams();
  const navigate = useNavigate();
  const { selectedSymbol, setSelectedSymbol, chartPrefs, setChartPrefs, setActiveOverlay } = useStore();

  const symbol = paramSymbol || selectedSymbol;

  const mainRef = useRef(null);
  const rsiRef = useRef(null);
  const macdRef = useRef(null);
  const mainChart = useRef(null);
  const rsiChart = useRef(null);
  const macdChart = useRef(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { period, interval, showRSI, showMACD, activeOverlays, mainHeight, rsiHeight, macdHeight } = chartPrefs;

  useEffect(() => {
    if (paramSymbol) setSelectedSymbol(paramSymbol);
  }, [paramSymbol]);

  const fetchChart = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/market/indicators', { params: { symbol, period, interval } });
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, period, interval]);

  const { lastUpdated, secondsLeft, refreshNow } = useAutoRefresh(fetchChart, REFRESH_MS);

  // Re-fetch immediately whenever symbol / period / interval changes.
  // Skip the very first render — useAutoRefresh already fires on mount.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    refreshNow();
  }, [symbol, period, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // Combined chart creation + synchronized time scales
  // All three panels are created together so we can wire bidirectional sync
  // once without fighting separate effect lifecycles.
  useEffect(() => {
    if (!data || !mainRef.current) return;

    // Destroy any previous instances
    mainChart.current?.remove(); mainChart.current = null;
    rsiChart.current?.remove();  rsiChart.current = null;
    macdChart.current?.remove(); macdChart.current = null;

    const closes = data.candles.map(c => c.close);
    // [chartInstance, domRef] pairs — used for sync + resize
    const panels = [];

    // ── Main chart ─────────────────────────────────────────────────────────────
    const main = createChart(mainRef.current, {
      width: mainRef.current.clientWidth, height: mainHeight,
      layout: { background: { color: '#030712' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
      timeScale: { timeVisible: true, borderColor: '#1f2937' },
      rightPriceScale: { borderColor: '#1f2937' },
    });
    mainChart.current = main;
    panels.push([main, mainRef]);

    const candleSeries = main.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    candleSeries.setData(data.candles.map(c => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    const cp = data.quote?.regularMarketPrice ?? data.candles?.[data.candles.length - 1]?.close;
    if (cp != null) {
      candleSeries.createPriceLine({
        price: cp, color: '#e2e8f0', lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: `${cp.toFixed(2)}`,
      });
    }

    for (const key of ['sma20', 'sma50', 'sma200', 'ema9', 'ema21', 'vwap']) {
      if (!activeOverlays[key] || !data[key]) continue;
      const ls = main.addSeries(LineSeries, { color: OVERLAY_COLORS[key], lineWidth: 1, priceLineVisible: false });
      ls.setData(data[key].map((v, i) => v !== null ? { time: data.candles[i]?.time, value: v } : null).filter(Boolean));
    }
    if (activeOverlays.bb && data.bb) {
      for (const key of ['upper', 'middle', 'lower']) {
        const s = main.addSeries(LineSeries, {
          color: '#64748b', lineWidth: 1, lineStyle: key === 'middle' ? 2 : 0, priceLineVisible: false,
        });
        s.setData(data.bb.map((b, i) => b ? { time: data.candles[i]?.time, value: b[key] } : null).filter(Boolean));
      }
    }
    main.timeScale().fitContent();

    // ── RSI panel ──────────────────────────────────────────────────────────────
    if (showRSI && rsiRef.current) {
      const rsiValues = computeRSIArray(closes, 14);
      const rsi = createChart(rsiRef.current, {
        width: rsiRef.current.clientWidth, height: rsiHeight,
        layout: { background: { color: '#030712' }, textColor: '#9ca3af' },
        grid: { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
        timeScale: { timeVisible: false, borderColor: '#1f2937' },
        rightPriceScale: { borderColor: '#1f2937', scaleMargins: { top: 0.1, bottom: 0.1 } },
      });
      rsiChart.current = rsi;
      panels.push([rsi, rsiRef]);

      const rsiSeries = rsi.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1, priceLineVisible: false });
      rsiSeries.setData(rsiValues.map((v, i) => v !== null ? { time: data.candles[i]?.time, value: v } : null).filter(Boolean));
      for (const [level, color] of [[70, '#ef444440'], [30, '#22c55e40']]) {
        const s = rsi.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: 2, priceLineVisible: false });
        s.setData(data.candles.map(c => ({ time: c.time, value: level })));
      }
    }

    // ── MACD panel ─────────────────────────────────────────────────────────────
    if (showMACD && macdRef.current) {
      const { macdLine, signalLine, histogram } = computeMACDArrays(closes);
      const macd = createChart(macdRef.current, {
        width: macdRef.current.clientWidth, height: macdHeight,
        layout: { background: { color: '#030712' }, textColor: '#9ca3af' },
        grid: { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
        timeScale: { timeVisible: false, borderColor: '#1f2937' },
        rightPriceScale: { borderColor: '#1f2937', scaleMargins: { top: 0.2, bottom: 0.2 } },
      });
      macdChart.current = macd;
      panels.push([macd, macdRef]);

      const histSeries = macd.addSeries(HistogramSeries, { priceLineVisible: false });
      histSeries.setData(histogram.map((v, i) => v !== null ? {
        time: data.candles[i]?.time, value: v,
        color: v >= 0 ? '#22c55e80' : '#ef444480',
      } : null).filter(Boolean));
      const macdS = macd.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, priceLineVisible: false });
      macdS.setData(macdLine.map((v, i) => v !== null ? { time: data.candles[i]?.time, value: v } : null).filter(Boolean));
      const sigS = macd.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false });
      sigS.setData(signalLine.map((v, i) => v !== null ? { time: data.candles[i]?.time, value: v } : null).filter(Boolean));
    }

    // ── Bidirectional time-scale sync ──────────────────────────────────────────
    // When any panel is zoomed or panned, all others follow at the same range.
    // The `syncing` flag prevents the handlers from triggering each other.
    let syncing = false;
    const chartInstances = panels.map(([c]) => c);
    for (const source of chartInstances) {
      source.timeScale().subscribeVisibleTimeRangeChange(range => {
        if (syncing || !range) return;
        syncing = true;
        for (const target of chartInstances) {
          if (target !== source) {
            try { target.timeScale().setVisibleRange(range); } catch { /* chart may be mid-destroy */ }
          }
        }
        syncing = false;
      });
    }

    // ── Resize observers ───────────────────────────────────────────────────────
    const ros = panels.map(([chart, ref]) => {
      const ro = new ResizeObserver(() => {
        if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
      });
      if (ref.current) ro.observe(ref.current);
      return ro;
    });

    return () => {
      ros.forEach(ro => ro.disconnect());
      panels.forEach(([c]) => { try { c.remove(); } catch { /* already gone */ } });
      mainChart.current = null;
      rsiChart.current  = null;
      macdChart.current = null;
    };
  }, [data, activeOverlays, showRSI, showMACD, mainHeight, rsiHeight, macdHeight]);

  const q = data?.quote || {};
  const lastCandle  = data?.candles?.[data.candles.length - 1];
  const prevCandle  = data?.candles?.[data.candles.length - 2];
  const currentPrice = q.regularMarketPrice ?? lastCandle?.close;
  const prevClose    = q.previousClose ?? prevCandle?.close;
  const priceChange  = currentPrice != null && prevClose != null ? currentPrice - prevClose : null;
  const pricePct     = priceChange != null && prevClose ? (priceChange / prevClose) * 100 : null;
  const priceUp      = priceChange == null ? null : priceChange >= 0;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p} onClick={() => setChartPrefs({ period: p })}
              className={period === p ? 'btn-primary' : 'btn-ghost'}>{p}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {INTERVALS.map(i => (
            <button key={i} onClick={() => setChartPrefs({ interval: i })}
              className={interval === i ? 'btn-primary' : 'btn-ghost'}>{i}</button>
          ))}
        </div>
        <div className="h-4 w-px bg-gray-700" />
        {Object.entries(OVERLAY_LABELS).map(([key, label]) => (
          <button key={key}
            onClick={() => setActiveOverlay(key, !activeOverlays[key])}
            className={`${activeOverlays[key] ? 'btn-primary' : 'btn-ghost'} inline-flex items-center gap-0.5`}
            style={activeOverlays[key] ? { backgroundColor: OVERLAY_COLORS[key] + '33', borderColor: OVERLAY_COLORS[key] } : {}}>
            {label}<Tip text={OVERLAY_TIPS[key]} below />
          </button>
        ))}
        <div className="h-4 w-px bg-gray-700" />
        <button onClick={() => setChartPrefs({ showRSI: !showRSI })}
          className={`${showRSI ? 'btn-primary' : 'btn-ghost'} inline-flex items-center gap-0.5`}>
          RSI<Tip text="Relative Strength Index — momentum oscillator 0–100. Above 70 = overbought, below 30 = oversold. Shown as sub-chart below price." below />
        </button>
        <button onClick={() => setChartPrefs({ showMACD: !showMACD })}
          className={`${showMACD ? 'btn-primary' : 'btn-ghost'} inline-flex items-center gap-0.5`}>
          MACD<Tip text="Moving Average Convergence Divergence — 12-day EMA minus 26-day EMA, with 9-day signal line. Histogram shows momentum." below />
        </button>
        <div className="ml-auto">
          <LiveBadge
            lastUpdated={lastUpdated}
            secondsLeft={secondsLeft}
            loading={loading}
            onRefresh={refreshNow}
            intervalSec={REFRESH_MS / 1000}
          />
        </div>
      </div>

      {!symbol && (
        <div className="card p-8 text-center text-gray-300 text-sm">
          Select a symbol from the header or type one in the search box
        </div>
      )}

      {loading && <div className="card p-8 text-center text-gray-300 text-sm animate-pulse">Loading {symbol}…</div>}
      {error && <div className="card p-4 text-red-400 text-xs">{error}</div>}

      {data && (
        <>
          {/* Price header */}
          <div className="card px-4 py-3 flex items-baseline gap-3">
            <span className="text-2xl font-bold mono text-gray-100">
              {currentPrice != null ? `$${fmt(currentPrice)}` : '—'}
            </span>
            {priceChange != null && (
              <span className={`text-sm font-medium mono ${priceUp ? 'text-green-400' : 'text-red-400'}`}>
                {priceUp ? '+' : ''}{fmt(priceChange)} ({priceUp ? '+' : ''}{fmt(pricePct)}%)
              </span>
            )}
            {prevClose != null && (
              <span className="text-[11px] text-gray-300 ml-1">
                prev close {fmt(prevClose)}
              </span>
            )}
            {q.liveAt && (
              <span className="text-[10px] text-gray-300 ml-auto">
                quote as of <span className="text-gray-300 mono">{q.liveAt}</span>
              </span>
            )}
          </div>

          {/* Stats row */}
          <div className="card p-3">
            <div className="grid grid-cols-7 gap-3 mb-2">
              {[
                ['Open',    fmt(q.open)],
                ['High',    fmt(q.dayHigh || lastCandle?.high)],
                ['Low',     fmt(q.dayLow  || lastCandle?.low)],
                ['Vol',     fmtVol(q.volume)],
                ['AvgVol',  fmtVol(q.avgVolume)],
                ['52W H',   fmt(q.fiftyTwoWeekHigh)],
                ['52W L',   fmt(q.fiftyTwoWeekLow)],
              ].map(([k, v]) => (
                <div key={k} className="text-center">
                  <div className="text-gray-300 text-[10px]">{k}</div>
                  <div className="text-gray-200 text-xs mono">{v}</div>
                </div>
              ))}
            </div>
            {/* Timestamp row */}
            <div className="flex items-center gap-3 pt-1.5 border-t border-gray-800/60 text-[10px] text-gray-300">
              {lastCandle?.time && (
                <span>
                  Last bar:{' '}
                  <span className="text-gray-300 mono">
                    {new Date(lastCandle.time * 1000).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                </span>
              )}
              {lastUpdated && (
                <span className="ml-auto">
                  Fetched:{' '}
                  <span className="text-gray-300 mono">
                    {lastUpdated.toLocaleTimeString('en-US', {
                      hour: '2-digit', minute: '2-digit', second: '2-digit',
                    })}
                    {' — '}
                    {lastUpdated.toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Main chart */}
          <div className="card overflow-hidden">
            <div className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-300">{symbol}</div>
            <div ref={mainRef} />
          </div>

          {/* RSI */}
          {showRSI && (
            <div className="card overflow-hidden">
              <div className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-300">RSI (14)</div>
              <div ref={rsiRef} />
            </div>
          )}

          {/* MACD */}
          {showMACD && (
            <div className="card overflow-hidden">
              <div className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-300">MACD (12, 26, 9)</div>
              <div ref={macdRef} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function computeRSIArray(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  result[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    result[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return result;
}

function emaArray(closes, period) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

function computeMACDArrays(closes, fast = 12, slow = 26, signal = 9) {
  const fastArr = emaArray(closes, fast);
  const slowArr = emaArray(closes, slow);
  const macdLineRaw = fastArr.map((f, i) => f !== null && slowArr[i] !== null ? f - slowArr[i] : null);

  const validStart = macdLineRaw.findIndex(v => v !== null);
  const signalLine = new Array(closes.length).fill(null);
  const histogram = new Array(closes.length).fill(null);

  if (validStart < 0 || macdLineRaw.length - validStart < signal) {
    return { macdLine: macdLineRaw, signalLine, histogram };
  }

  const macdVals = macdLineRaw.slice(validStart);
  const k = 2 / (signal + 1);
  let sig = macdVals.slice(0, signal).reduce((a, b) => a + b, 0) / signal;
  signalLine[validStart + signal - 1] = sig;

  for (let i = signal; i < macdVals.length; i++) {
    sig = macdVals[i] * k + sig * (1 - k);
    const absIdx = validStart + i;
    signalLine[absIdx] = sig;
    histogram[absIdx] = macdLineRaw[absIdx] - sig;
  }

  return { macdLine: macdLineRaw, signalLine, histogram };
}
