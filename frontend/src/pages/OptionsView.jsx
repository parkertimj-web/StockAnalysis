import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import useStore from '../store/store.js';
import api from '../api/client.js';

function fmt(n, d = 2) { return n != null ? Number(n).toFixed(d) : '—'; }

function pctFromAtm(strike, atm) {
  if (!atm) return null;
  return ((strike - atm) / atm) * 100;
}

// Compact 6-column table
function ContractTable({ contracts, underlyingPrice, side }) {
  if (!contracts.length) return (
    <div className="px-3 py-2 text-gray-300 text-[10px]">No contracts</div>
  );
  const accent = side === 'calls' ? 'text-green-400' : 'text-red-400';
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-gray-800">
          <th className={`px-2 py-1 text-left font-medium ${accent}`}>Strike</th>
          <th className="px-2 py-1 text-left text-gray-300 font-medium">%ATM</th>
          <th className="px-2 py-1 text-right text-gray-300 font-medium">Last</th>
          <th className="px-2 py-1 text-right text-gray-300 font-medium">Bid</th>
          <th className="px-2 py-1 text-right text-gray-300 font-medium">Ask</th>
          <th className="px-2 py-1 text-right text-gray-300 font-medium">Vol</th>
        </tr>
      </thead>
      <tbody>
        {contracts.map(c => {
          const pct   = pctFromAtm(c.strike, underlyingPrice);
          const isAtm = pct != null && Math.abs(pct) < 1.5;
          const itm   = c.inTheMoney;
          return (
            <tr key={c.contractSymbol}
              className={`border-b border-gray-800/20 hover:bg-gray-800/30 ${isAtm ? 'bg-yellow-900/20' : itm ? 'bg-blue-950/20' : ''}`}>
              <td className={`px-2 py-1 mono font-semibold ${isAtm ? 'text-yellow-300' : itm ? 'text-blue-300' : 'text-gray-200'}`}>
                {fmt(c.strike)}
              </td>
              <td className={`px-2 py-1 mono text-[10px] ${pct != null && pct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {pct != null ? (pct > 0 ? '+' : '') + pct.toFixed(1) + '%' : '—'}
              </td>
              <td className="px-2 py-1 mono text-right text-gray-300">{fmt(c.lastPrice)}</td>
              <td className="px-2 py-1 mono text-right text-gray-300">{fmt(c.bid)}</td>
              <td className="px-2 py-1 mono text-right text-gray-300">{fmt(c.ask)}</td>
              <td className="px-2 py-1 mono text-right text-gray-300">
                {c.volume != null ? c.volume.toLocaleString() : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Group dates by year, cap at 2027
function groupByYear(dates) {
  const groups = {};
  for (const d of dates) {
    const yr = new Date(d).getUTCFullYear();
    if (yr > 2027) continue;
    if (!groups[yr]) groups[yr] = [];
    groups[yr].push(d);
  }
  return Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b));
}

export default function OptionsView() {
  const { symbol: paramSymbol } = useParams();
  const { selectedSymbol, setSelectedSymbol, optionsPrefs, setOptionsPrefs } = useStore();
  const symbol = paramSymbol || selectedSymbol;

  const [allDates, setAllDates]           = useState([]);
  const [underlyingPrice, setUnderlying]  = useState(null);
  const [loadingDates, setLoadingDates]   = useState(false);
  const [datesError, setDatesError]       = useState(null);
  const [selectedDates, setSelectedDates] = useState(new Set());
  const [chainCache, setChainCache]       = useState({});
  const [loadingChains, setLoadingChains] = useState(new Set());
  const [strikeMin, setStrikeMin]         = useState(optionsPrefs.strikeMin || '');
  const [strikeMax, setStrikeMax]         = useState(optionsPrefs.strikeMax || '');

  const { view, filter } = optionsPrefs;

  // Persist strike range whenever it changes
  useEffect(() => { setOptionsPrefs({ strikeMin, strikeMax }); }, [strikeMin, strikeMax]);

  useEffect(() => {
    if (paramSymbol) setSelectedSymbol(paramSymbol);
  }, [paramSymbol]);

  useEffect(() => {
    if (!symbol) return;
    setLoadingDates(true);
    setDatesError(null);
    setAllDates([]);
    setSelectedDates(new Set());
    setChainCache({});

    api.get(`/options/${symbol}`)
      .then(r => {
        const now   = Date.now();
        // Filter out any dates that have already expired
        const dates = (r.data.expirationDates || []).filter(d => d > now);
        setAllDates(dates);
        setUnderlying(r.data.underlyingPrice ?? null);

        const fridays = dates.filter(d => new Date(d).getUTCDay() === 5);

        // Restore previously selected dates that are still valid and still Fridays
        const saved   = (optionsPrefs.savedDates || []).filter(d => dates.includes(d));
        const initial = saved.length ? saved : (fridays.length ? [fridays[0]] : []);

        if (!initial.length) return;
        setSelectedDates(new Set(initial));

        // Fetch chain for each initially-selected date
        initial.forEach(dateMs => {
          api.get(`/options/${symbol}`, { params: { date: Math.floor(dateMs / 1000) } })
            .then(r2 => {
              setChainCache(prev => ({
                ...prev,
                [dateMs]: { calls: r2.data.calls || [], puts: r2.data.puts || [] },
              }));
              if (r2.data.underlyingPrice) setUnderlying(r2.data.underlyingPrice);
            })
            .catch(() => setChainCache(prev => ({ ...prev, [dateMs]: { calls: [], puts: [], error: true } })));
        });
      })
      .catch(e => setDatesError(e.response?.data?.error || e.message))
      .finally(() => setLoadingDates(false));
  }, [symbol]);

  const fetchChain = useCallback(async (dateMs) => {
    if (chainCache[dateMs] || loadingChains.has(dateMs)) return;
    setLoadingChains(prev => new Set(prev).add(dateMs));
    try {
      const r = await api.get(`/options/${symbol}`, { params: { date: Math.floor(dateMs / 1000) } });
      setChainCache(prev => ({ ...prev, [dateMs]: { calls: r.data.calls || [], puts: r.data.puts || [] } }));
      if (r.data.underlyingPrice) setUnderlying(r.data.underlyingPrice);
    } catch {
      setChainCache(prev => ({ ...prev, [dateMs]: { calls: [], puts: [], error: true } }));
    } finally {
      setLoadingChains(prev => { const s = new Set(prev); s.delete(dateMs); return s; });
    }
  }, [symbol, chainCache, loadingChains]);

  function toggleDate(dateMs) {
    setSelectedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateMs)) { next.delete(dateMs); }
      else { next.add(dateMs); fetchChain(dateMs); }
      setOptionsPrefs({ savedDates: [...next] });
      return next;
    });
  }

  function applyStrikePreset(pct) {
    if (!underlyingPrice || pct === null) { setStrikeMin(''); setStrikeMax(''); return; }
    setStrikeMin((underlyingPrice * (1 - pct / 100)).toFixed(0));
    setStrikeMax((underlyingPrice * (1 + pct / 100)).toFixed(0));
  }

  function applyFilters(contracts) {
    let out = contracts;
    if (filter === 'itm') out = out.filter(c => c.inTheMoney);
    if (filter === 'otm') out = out.filter(c => !c.inTheMoney);
    const mn = parseFloat(strikeMin), mx = parseFloat(strikeMax);
    if (!isNaN(mn)) out = out.filter(c => c.strike >= mn);
    if (!isNaN(mx)) out = out.filter(c => c.strike <= mx);
    return out;
  }

  const sortedSelected = [...selectedDates].sort((a, b) => a - b);

  if (!symbol) return (
    <div className="card p-8 text-center text-gray-300 text-sm">Select a symbol</div>
  );

  return (
    <div className="space-y-3">

      {/* ── Sticky header: top bar + strike range + date picker ── */}
      <div className="sticky top-0 z-20 bg-gray-950 space-y-3 pb-3">

        {/* ── Top bar ── */}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-200">{symbol} Options</h1>
          {underlyingPrice && (
            <span className="text-xs text-gray-300 mono">@ ${fmt(underlyingPrice)}</span>
          )}
          <div className="flex gap-1">
            {['both','calls','puts'].map(v => (
              <button key={v} onClick={() => setOptionsPrefs({ view: v })}
                className={view === v ? 'btn-primary' : 'btn-ghost'}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {['all','itm','otm'].map(f => (
              <button key={f} onClick={() => setOptionsPrefs({ filter: f })}
                className={filter === f ? 'btn-primary' : 'btn-ghost'}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* ── Strike range ── */}
        <div className="card p-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-gray-300 uppercase tracking-wide">Strike</span>
          {[['±5%',5],['±10%',10],['±20%',20],['±50%',50],['All',null]].map(([lbl,pct]) => (
            <button key={lbl} onClick={() => applyStrikePreset(pct)}
              className="btn-ghost py-0.5 px-2 text-[10px]">{lbl}</button>
          ))}
          <div className="flex items-center gap-1 ml-auto">
            <input type="number" placeholder="Min" value={strikeMin}
              onChange={e => setStrikeMin(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 w-18 focus:outline-none focus:border-blue-500" />
            <span className="text-gray-300 text-xs">–</span>
            <input type="number" placeholder="Max" value={strikeMax}
              onChange={e => setStrikeMax(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 w-18 focus:outline-none focus:border-blue-500" />
          </div>
        </div>

        {/* ── Date picker ── */}
        <div className="card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-300 uppercase tracking-wide">
              Expiration Dates
              {selectedDates.size > 0 && <span className="ml-1 text-blue-400">· {selectedDates.size} selected</span>}
            </span>
            <button onClick={() => { setSelectedDates(new Set()); setOptionsPrefs({ savedDates: [] }); }}
              className="btn-ghost py-0.5 px-2 text-[10px]">Clear</button>
          </div>

          {loadingDates && <div className="text-gray-300 text-xs animate-pulse">Loading…</div>}
          {datesError   && <div className="text-red-400 text-xs">{datesError}</div>}

          {groupByYear(allDates.filter(d => new Date(d).getUTCDay() === 5)).map(([year, dates]) => (
            <div key={year}>
              <div className="text-[10px] text-gray-300 uppercase tracking-widest mb-1">
                {year}{Number(year) >= new Date().getFullYear() + 1 ? ' · LEAPS' : ''}
              </div>
              <div className="flex flex-wrap gap-1">
                {dates.map(d => {
                  const on        = selectedDates.has(d);
                  const isLoading = loadingChains.has(d);
                  return (
                    <button key={d} onClick={() => toggleDate(d)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        on ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                           : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-blue-600 hover:text-gray-200'
                      } ${isLoading ? 'opacity-50' : ''}`}>
                      {format(new Date(d), 'MMM d')}{isLoading ? ' …' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Side-by-side chains ── */}
      {sortedSelected.length === 0 && !loadingDates && allDates.length > 0 && (
        <div className="card p-6 text-center text-gray-300 text-xs">
          Select one or more expiration dates above
        </div>
      )}

      {sortedSelected.length > 0 && (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
            {sortedSelected.map(dateMs => {
              const chain     = chainCache[dateMs];
              const label     = format(new Date(dateMs), 'MMM d, yyyy');
              const isLoading = loadingChains.has(dateMs);

              return (
                <div key={dateMs} className="card flex-shrink-0 w-72 overflow-hidden">
                  {/* Date header */}
                  <div className="px-3 py-1.5 border-b border-gray-800 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-300">{label}</span>
                    {isLoading && <span className="text-[10px] text-gray-300 animate-pulse">…</span>}
                    {chain?.error && <span className="text-[10px] text-red-500">No data</span>}
                  </div>

                  {chain && !chain.error && (
                    <>
                      {(view === 'both' || view === 'calls') && (
                        <div>
                          <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold text-green-500 uppercase tracking-wide">
                            Calls
                          </div>
                          <ContractTable
                            contracts={applyFilters(chain.calls)}
                            underlyingPrice={underlyingPrice}
                            side="calls"
                          />
                        </div>
                      )}
                      {view === 'both' && (
                        <div className="border-t border-gray-800 mt-1" />
                      )}
                      {(view === 'both' || view === 'puts') && (
                        <div>
                          <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold text-red-500 uppercase tracking-wide">
                            Puts
                          </div>
                          <ContractTable
                            contracts={applyFilters(chain.puts)}
                            underlyingPrice={underlyingPrice}
                            side="puts"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
