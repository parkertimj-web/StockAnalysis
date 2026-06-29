// Shared marker for the RSI mean-reversion state computed in the signal engine.
// Same logic the Backtest page trades: buy an oversold dip in an uptrend,
// take profit once RSI swings back to overbought.

export const MEAN_REV_TIP =
  'RSI mean reversion — the Backtest strategy applied to today. ' +
  'Buy Setup: RSI < 40 with price above SMA 50 (oversold dip in an uptrend). ' +
  'Oversold: RSI < 40 but below SMA 50 (no trend support). ' +
  'Take Profit: RSI > 65 (reversion complete). ' +
  'B / S are the buy and sell price points — the lower and upper Bollinger ' +
  'bands (20-day mean ± 2σ); they light up when price reaches them.';

// Client-side computation of the same state the backend signal engine
// produces — for pages (e.g. Chart) that have RSI + SMA50 but don't call
// the signals endpoint. Keep thresholds in sync with signalEngine.js.
export function meanRevFromValues(rsi, price, sma50, oversold = 40, overbought = 65) {
  if (rsi == null) return { state: 'neutral', label: 'N/A', rsi: null };
  const aboveSma50 = sma50 != null ? price > sma50 : null;
  if (rsi < oversold) {
    return aboveSma50
      ? { state: 'entry',    label: 'Buy Setup', rsi, aboveSma50 }
      : { state: 'oversold', label: 'Oversold',  rsi, aboveSma50 };
  }
  if (rsi > overbought) return { state: 'overbought', label: 'Take Profit', rsi, aboveSma50 };
  return { state: 'neutral', label: 'Neutral', rsi, aboveSma50 };
}

const MR_STYLES = {
  entry:      'border-green-600 text-green-400 bg-green-500/10',
  oversold:   'border-yellow-600 text-yellow-400 bg-yellow-500/10',
  overbought: 'border-red-600 text-red-400 bg-red-500/10',
  neutral:    'border-gray-700 text-gray-500',
};

export default function MeanRevBadge({ mr, size = 'sm' }) {
  if (!mr || !mr.state) return <span className="text-gray-600">—</span>;
  const cls = MR_STYLES[mr.state] || MR_STYLES.neutral;
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]';
  return (
    <span className={`inline-block border rounded font-medium whitespace-nowrap ${pad} ${cls}`}>
      {mr.label}
    </span>
  );
}
