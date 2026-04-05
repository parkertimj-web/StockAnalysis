import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ChartView from './pages/ChartView.jsx';
import OptionsView from './pages/OptionsView.jsx';
import CallsMatrixView from './pages/CallsMatrixView.jsx';
import WatchlistChartsView from './pages/WatchlistChartsView.jsx';
import SignalsView from './pages/SignalsView.jsx';
import AlertsView from './pages/AlertsView.jsx';
import JournalView from './pages/JournalView.jsx';
import BacktestView from './pages/BacktestView.jsx';
import FundamentalsView from './pages/FundamentalsView.jsx';
import MovingAvgView from './pages/MovingAvgView.jsx';
import AlertToastBar from './components/common/AlertToastBar.jsx';

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
        </Route>
      </Routes>
    </>
  );
}
