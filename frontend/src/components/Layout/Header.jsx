import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useStore from '../../store/store.js';
import { Search } from 'lucide-react';

export default function Header() {
  const { selectedSymbol, setSelectedSymbol, watchlist } = useStore();
  const [input, setInput] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const symbolPages = ['/chart', '/options', '/calls-matrix'];
  const isSymbolPage = symbolPages.some(p => location.pathname.startsWith(p));

  function handleSelect(e) {
    const sym = e.target.value;
    setSelectedSymbol(sym);
    if (location.pathname.startsWith('/chart')) navigate(`/chart/${sym}`);
    else if (location.pathname.startsWith('/options')) navigate(`/options/${sym}`);
    else if (location.pathname.startsWith('/calls-matrix')) navigate(`/calls-matrix/${sym}`);
  }

  function handleSearch(e) {
    e.preventDefault();
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    setSelectedSymbol(sym);
    if (isSymbolPage) {
      const base = location.pathname.split('/')[1];
      navigate(`/${base}/${sym}`);
    } else {
      navigate(`/chart/${sym}`);
    }
    setInput('');
  }

  return (
    <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-4">
      {isSymbolPage && watchlist.length > 0 && (
        <select
          value={selectedSymbol || ''}
          onChange={handleSelect}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2 py-1"
        >
          <option value="">Select symbol…</option>
          {watchlist.map(w => (
            <option key={w.symbol} value={w.symbol}>{w.symbol}</option>
          ))}
        </select>
      )}

      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Symbol…"
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg pl-6 pr-2 py-1 w-28 focus:outline-none focus:border-blue-500"
          />
        </div>
        <button type="submit" className="btn-primary">Go</button>
      </form>

      {selectedSymbol && (
        <span className="text-gray-300 text-xs mono">{selectedSymbol}</span>
      )}
    </header>
  );
}
