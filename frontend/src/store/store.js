import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useStore = create(
  persist(
    (set, get) => ({
      selectedSymbol: null,
      setSelectedSymbol: (sym) => set({ selectedSymbol: sym }),

      watchlist: [],
      setWatchlist: (list) => set({ watchlist: list }),

      chartPrefs: {
        mainHeight: 480,
        rsiHeight: 150,
        macdHeight: 150,
        period: '3mo',
        interval: '1d',
        showRSI: true,
        showMACD: false,
        activeOverlays: {
          sma20: true,
          sma50: true,
          ema9: false,
          ema21: false,
          vwap: false,
          sma200: false,
          bb: false,
        },
      },
      setChartPrefs: (update) =>
        set(s => ({ chartPrefs: { ...s.chartPrefs, ...update } })),
      setActiveOverlay: (key, val) =>
        set(s => ({
          chartPrefs: {
            ...s.chartPrefs,
            activeOverlays: { ...s.chartPrefs.activeOverlays, [key]: val },
          },
        })),

      // savedDates: array of ms timestamps (Set not JSON-serialisable)
      optionsPrefs: { view: 'both', filter: 'all', strikeMin: '', strikeMax: '', savedDates: [] },
      setOptionsPrefs: (update) =>
        set(s => ({ optionsPrefs: { ...s.optionsPrefs, ...update } })),

      callsMatrixPrefs: {
        forSymbol: null,
        selectedExpiries: [],
        strikeMin: '',
        strikeMax: '',
      },
      setCallsMatrixPrefs: (update) =>
        set(s => ({ callsMatrixPrefs: { ...s.callsMatrixPrefs, ...update } })),
    }),
    {
      name: 'stockapp-storage',
      partialize: (state) => ({
        selectedSymbol: state.selectedSymbol,
        watchlist: state.watchlist,
        chartPrefs: state.chartPrefs,
        optionsPrefs: state.optionsPrefs,
        callsMatrixPrefs: state.callsMatrixPrefs,
      }),
    }
  )
);

export default useStore;
