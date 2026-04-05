import { useEffect, useState } from 'react';
import { Plus, X, CheckCircle, Trash2, Brain } from 'lucide-react';
import { format } from 'date-fns';
import api from '../api/client.js';
import Modal from '../components/common/Modal.jsx';

function fmt(n, d = 2) { return n != null ? n.toFixed(d) : '—'; }

const EMPTY_FORM = {
  symbol: '', trade_type: 'stock', direction: 'long',
  entry_date: new Date().toISOString().slice(0, 10),
  entry_price: '', quantity: '', stop_loss: '', target_price: '', notes: '', tags: '',
};

export default function JournalView() {
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [closeModal, setCloseModal] = useState(null);
  const [aiModal, setAiModal] = useState(null);
  const [closeForm, setCloseForm] = useState({ exit_price: '', exit_date: new Date().toISOString().slice(0, 10) });
  const [form, setForm] = useState(EMPTY_FORM);
  const [statusFilter, setStatusFilter] = useState('all');
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  function load() {
    const params = statusFilter !== 'all' ? { status: statusFilter } : {};
    api.get('/journal', { params }).then(r => setTrades(r.data)).catch(() => {});
    api.get('/journal/stats').then(r => setStats(r.data)).catch(() => {});
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function addTrade(e) {
    e.preventDefault();
    await api.post('/journal', form);
    setShowAdd(false);
    setForm(EMPTY_FORM);
    load();
  }

  async function closeTrade(e) {
    e.preventDefault();
    await api.patch(`/journal/${closeModal.id}/close`, closeForm);
    setCloseModal(null);
    load();
  }

  async function deleteTrade(id) {
    await api.delete(`/journal/${id}`);
    load();
  }

  async function loadAI(trade) {
    setAiModal(trade);
    setAiText('');
    setAiLoading(true);
    try {
      const r = await api.get(`/journal/${trade.id}/ai-analysis`);
      setAiText(r.data.analysis);
    } catch (e) {
      setAiText(e.response?.data?.error || 'Failed to load AI analysis');
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-200">Trade Journal</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1">
          <Plus size={12} /> New Trade
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            ['Total P&L',  `$${fmt(stats.totalPnl)}`,   stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'],
            ['Win Rate',   `${fmt(stats.winRate, 1)}%`,  'text-blue-400'],
            ['Expectancy', `$${fmt(stats.expectancy)}`,  stats.expectancy >= 0 ? 'text-green-400' : 'text-red-400'],
            ['Open Trades', stats.openTrades,            'text-yellow-400'],
          ].map(([label, val, cls]) => (
            <div key={label} className="card p-3 text-center">
              <div className="text-gray-300 text-[10px]">{label}</div>
              <div className={`text-sm font-semibold mono ${cls}`}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-1">
        {['all', 'open', 'closed'].map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={statusFilter === f ? 'btn-primary' : 'btn-ghost'}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Trades table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              {['Symbol', 'Dir', 'Entry Date', 'Entry $', 'Qty', 'Exit $', 'P&L', 'Status', 'Actions'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-gray-300 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map(t => (
              <tr key={t.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                <td className="px-3 py-2 font-semibold text-gray-100">{t.symbol}</td>
                <td className={`px-3 py-2 font-medium ${t.direction === 'long' ? 'text-green-400' : 'text-red-400'}`}>
                  {t.direction}
                </td>
                <td className="px-3 py-2 text-gray-300">{t.entry_date}</td>
                <td className="px-3 py-2 mono text-gray-200">${fmt(t.entry_price)}</td>
                <td className="px-3 py-2 mono text-gray-300">{t.quantity}</td>
                <td className="px-3 py-2 mono text-gray-300">{t.exit_price ? `$${fmt(t.exit_price)}` : '—'}</td>
                <td className={`px-3 py-2 mono font-medium ${t.pnl > 0 ? 'text-green-400' : t.pnl < 0 ? 'text-red-400' : 'text-gray-300'}`}>
                  {t.pnl != null ? `$${fmt(t.pnl)}` : '—'}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${t.status === 'open' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-gray-800 text-gray-300'}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {t.status === 'open' && (
                      <button onClick={() => { setCloseModal(t); setCloseForm({ exit_price: '', exit_date: new Date().toISOString().slice(0, 10) }); }}
                        className="btn-ghost p-1" title="Close trade">
                        <CheckCircle size={12} className="text-green-500" />
                      </button>
                    )}
                    <button onClick={() => loadAI(t)} className="btn-ghost p-1" title="AI analysis">
                      <Brain size={12} className="text-purple-400" />
                    </button>
                    <button onClick={() => deleteTrade(t.id)} className="btn-ghost p-1" title="Delete">
                      <Trash2 size={12} className="text-gray-300 hover:text-red-400" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {trades.length === 0 && (
          <div className="p-8 text-center text-gray-300 text-sm">No trades yet</div>
        )}
      </div>

      {/* Add trade modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Trade" width="max-w-xl">
        <form onSubmit={addTrade} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Symbol',      'symbol',      'text',   'AAPL'],
              ['Entry Date',  'entry_date',  'date',   ''],
              ['Entry Price', 'entry_price', 'number', '150'],
              ['Quantity',    'quantity',    'number', '10'],
              ['Stop Loss',   'stop_loss',   'number', '145'],
              ['Target',      'target_price','number', '165'],
            ].map(([label, name, type, ph]) => (
              <div key={name}>
                <label className="text-xs text-gray-300 mb-1 block">{label}</label>
                <input
                  required={['symbol','entry_date','entry_price','quantity'].includes(name)}
                  type={type}
                  value={form[name]}
                  onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
                  placeholder={ph}
                  step={type === 'number' ? 'any' : undefined}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-300 mb-1 block">Direction</label>
              <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2">
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-300 mb-1 block">Type</label>
              <select value={form.trade_type} onChange={e => setForm(f => ({ ...f, trade_type: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2">
                <option value="stock">Stock</option>
                <option value="options">Options</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-300 mb-1 block">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
          <button type="submit" className="btn-primary w-full text-center">Add Trade</button>
        </form>
      </Modal>

      {/* Close trade modal */}
      <Modal open={!!closeModal} onClose={() => setCloseModal(null)} title={`Close ${closeModal?.symbol}`}>
        <form onSubmit={closeTrade} className="space-y-3">
          {[
            ['Exit Price', 'exit_price', 'number'],
            ['Exit Date',  'exit_date',  'date'],
          ].map(([label, name, type]) => (
            <div key={name}>
              <label className="text-xs text-gray-300 mb-1 block">{label}</label>
              <input
                required
                type={type}
                value={closeForm[name]}
                onChange={e => setCloseForm(f => ({ ...f, [name]: e.target.value }))}
                step={type === 'number' ? 'any' : undefined}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
          ))}
          <button type="submit" className="btn-primary w-full text-center">Close Trade</button>
        </form>
      </Modal>

      {/* AI modal */}
      <Modal open={!!aiModal} onClose={() => setAiModal(null)} title={`AI Analysis — ${aiModal?.symbol}`}>
        {aiLoading ? (
          <div className="text-center text-gray-300 text-sm py-4 animate-pulse">Analysing…</div>
        ) : (
          <p className="text-sm text-gray-300 leading-relaxed">{aiText}</p>
        )}
      </Modal>
    </div>
  );
}
