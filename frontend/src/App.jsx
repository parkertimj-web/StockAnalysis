import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout.jsx';
import AlertToastBar from './components/common/AlertToastBar.jsx';

// Each page is its own chunk, so the first load only downloads the page being
// opened instead of all pages plus both chart libraries in one ~1 MB bundle.
const Dashboard           = lazy(() => import('./pages/Dashboard.jsx'));
const ChartView           = lazy(() => import('./pages/ChartView.jsx'));
const OptionsView         = lazy(() => import('./pages/OptionsView.jsx'));
const CallsMatrixView     = lazy(() => import('./pages/CallsMatrixView.jsx'));
const WatchlistChartsView = lazy(() => import('./pages/WatchlistChartsView.jsx'));
const SignalsView         = lazy(() => import('./pages/SignalsView.jsx'));
const AlertsView          = lazy(() => import('./pages/AlertsView.jsx'));
const JournalView         = lazy(() => import('./pages/JournalView.jsx'));
const BacktestView        = lazy(() => import('./pages/BacktestView.jsx'));
const FundamentalsView    = lazy(() => import('./pages/FundamentalsView.jsx'));
const MovingAvgView       = lazy(() => import('./pages/MovingAvgView.jsx'));
const MacroCyclesView     = lazy(() => import('./pages/MacroCyclesView.jsx'));
const JapanWatchView      = lazy(() => import('./pages/JapanWatchView.jsx'));
const ChinaWatchView      = lazy(() => import('./pages/ChinaWatchView.jsx'));

export default function App() {
  return (
    <>
      <AlertToastBar />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="chart/:symbol?" element={<ChartView />} />
          <Route path="options/:symbol?" element={<OptionsView />} />
          <Route path="calls-matrix/:symbol?" element={<CallsMatrixView />} />
          <Route path="watchlist-charts" element={<WatchlistChartsView />} />
          <Route path="signals" element={<SignalsView />} />
          <Route path="alerts" element={<AlertsView />} />
          <Route path="journal" element={<JournalView />} />
          <Route path="backtest" element={<BacktestView />} />
          <Route path="fundamentals" element={<FundamentalsView />} />
          <Route path="moving-average" element={<MovingAvgView />} />
          <Route path="crashes" element={<MacroCyclesView />} />
          <Route path="japan-watch" element={<JapanWatchView />} />
          <Route path="china-watch" element={<ChinaWatchView />} />
        </Route>
      </Routes>
    </>
  );
}
