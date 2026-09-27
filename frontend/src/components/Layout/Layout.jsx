import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import ErrorBoundary from '../common/ErrorBoundary.jsx';

export default function Layout() {
  const location = useLocation();
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-4">
          {/* key resets the boundary on navigation so an error on one page doesn't stick */}
          <ErrorBoundary key={location.pathname} label="This page hit an error">
            {/* Pages are code-split; the fallback shows while a page's chunk downloads */}
            <Suspense fallback={<div className="card p-8 text-center text-gray-400 text-sm animate-pulse">Loading…</div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
