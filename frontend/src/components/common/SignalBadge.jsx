const CONFIGS = {
  strong_buy:  { label: 'Strong Buy',  bg: 'bg-emerald-600',  text: 'text-white' },
  buy:         { label: 'Buy',         bg: 'bg-green-700',    text: 'text-white' },
  neutral:     { label: 'Neutral',     bg: 'bg-gray-700',     text: 'text-gray-300' },
  sell:        { label: 'Sell',        bg: 'bg-orange-700',   text: 'text-white' },
  strong_sell: { label: 'Strong Sell', bg: 'bg-red-700',      text: 'text-white' },
};

export default function SignalBadge({ signal, score, max, size = 'sm' }) {
  const cfg = CONFIGS[signal] || CONFIGS.neutral;
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${pad} ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
      {score !== undefined && max !== undefined && (
        <span className="opacity-75 mono text-[10px]">{score}/{max}</span>
      )}
    </span>
  );
}

export function ScoreBar({ score, max }) {
  const pct = max > 0 ? ((score + max) / (2 * max)) * 100 : 50;
  const color = score > 0 ? 'bg-green-500' : score < 0 ? 'bg-red-500' : 'bg-gray-600';

  return (
    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
      />
    </div>
  );
}
