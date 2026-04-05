import { RefreshCw } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

/**
 * Shows a pulsing "LIVE" dot + countdown + last-updated time.
 * Props:
 *   lastUpdated  — Date | null
 *   secondsLeft  — number | null
 *   loading      — bool
 *   onRefresh    — () => void
 *   intervalSec  — number (for display, e.g. 60)
 */
export default function LiveBadge({ lastUpdated, secondsLeft, loading, onRefresh, intervalSec }) {
  const isHot = secondsLeft != null && secondsLeft <= Math.max(intervalSec * 0.15, 5);

  return (
    <div className="flex items-center gap-2">
      {/* Pulsing live dot */}
      <span className="relative flex items-center">
        <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`} />
        {!loading && isHot && (
          <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-green-500 animate-ping opacity-75" />
        )}
      </span>

      {/* Last updated */}
      {lastUpdated && !loading && (
        <span className="text-[10px] text-gray-300">
          {formatDistanceToNowStrict(lastUpdated, { addSuffix: true })}
        </span>
      )}
      {loading && <span className="text-[10px] text-yellow-600 animate-pulse">updating…</span>}

      {/* Countdown */}
      {secondsLeft != null && !loading && (
        <span className={`text-[10px] mono ${isHot ? 'text-green-500' : 'text-gray-300'}`}>
          {secondsLeft}s
        </span>
      )}

      {/* Manual refresh */}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="text-gray-300 hover:text-gray-300 transition-colors disabled:opacity-30"
        title="Refresh now"
      >
        <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}
