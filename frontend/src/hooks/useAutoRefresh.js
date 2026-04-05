import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Auto-refresh hook.
 * @param {Function} callback  — async function that fetches data
 * @param {number}   intervalMs — how often to re-run (ms)
 * @param {boolean}  pauseWhenHidden — pause when browser tab is not visible
 * Returns { lastUpdated, secondsLeft, refreshNow }
 */
export function useAutoRefresh(callback, intervalMs, pauseWhenHidden = true) {
  const [lastUpdated, setLastUpdated]   = useState(null);   // Date
  const [secondsLeft, setSecondsLeft]   = useState(null);   // countdown
  const timerRef   = useRef(null);
  const countRef   = useRef(null);
  const cbRef      = useRef(callback);
  const inFlight   = useRef(false);

  // Keep callback ref fresh so closure in interval always calls latest version
  useEffect(() => { cbRef.current = callback; }, [callback]);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await cbRef.current();
      setLastUpdated(new Date());
      setSecondsLeft(Math.round(intervalMs / 1000));
    } finally {
      inFlight.current = false;
    }
  }, [intervalMs]);

  // Schedule repeating interval
  useEffect(() => {
    // Run immediately on mount
    run();

    timerRef.current = setInterval(() => {
      if (pauseWhenHidden && document.visibilityState === 'hidden') return;
      run();
    }, intervalMs);

    // Tick countdown every second
    countRef.current = setInterval(() => {
      if (pauseWhenHidden && document.visibilityState === 'hidden') return;
      setSecondsLeft(s => (s != null && s > 0 ? s - 1 : 0));
    }, 1000);

    // Resume immediately when tab becomes visible again
    function onVisible() {
      if (document.visibilityState === 'visible') run();
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timerRef.current);
      clearInterval(countRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [run, intervalMs, pauseWhenHidden]);

  return { lastUpdated, secondsLeft, refreshNow: run };
}
