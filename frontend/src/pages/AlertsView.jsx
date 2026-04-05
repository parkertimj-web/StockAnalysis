import { useEffect, useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Bell } from 'lucide-react';
import { format } from 'date-fns';
import api from '../api/client.js';
import Modal from '../components/common/Modal.jsx';

export default function AlertsView() {
  const [alerts, setAlerts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ symbol: '', condition: 'above', value: '', message: '', alert_type: 'price' });

  function load() {
    api.get('/alerts').then(r => setAlerts(r.data)).catch(() => {});
    api.get('/alerts/log').then(r => setLogs(r.data)).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function addAlert(e) {
    e.preventDefault();
    await api.post('/alerts', form);
    setShowAdd(false);
    setForm({ symbol: '', condition: 'above', value: '', message: '', alert_type: 'price' });
    load();
  }

  async function deleteAlert(id) {
    await api.delete(`/alerts/${id}`);
    load();
  }

  async function toggleAlert(id) {
    await api.patch(`/alerts/${id}/toggle`);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-200">Alerts</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1">
          <Plus size={12} /> New Alert
        </button>
      </div>

      {/* Active alerts */}
      <div className="card divide-y divide-gray-800">
        {alerts.length === 0 && (
          <div className="p-6 text-center text-gray-300 text-sm">No alerts configured</div>
        )}
        {alerts.map(a => (
          <div key={a.id} className="flex items-center gap-3 px-4 py-3">
            <Bell size={14} className={a.is_active ? 'text-yellow-400' : 'text-gray-300'} />
            <div className="flex-1">
              <div className="text-xs font-semibold text-gray-200">
                {a.symbol} <span className="text-gray-300 font-normal">{a.condition}</span> ${a.value}
              </div>
              {a.message && <div className="text-[10px] text-gray-300 mt-0.5">{a.message}</div>}
              <div className="text-[10px] text-gray-300 mt-0.5">{a.alert_type}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleAlert(a.id)} className="text-gray-300 hover:text-blue-400">
                {a.is_active ? <ToggleRight size={16} className="text-blue-500" /> : <ToggleLeft size={16} />}
              </button>
              <button onClick={() => deleteAlert(a.id)} className="text-gray-300 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Alert log */}
      {logs.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-300 mb-2">Recent Fired Alerts</div>
          <div className="card divide-y divide-gray-800">
            {logs.map(l => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-2">
                <div className="flex-1">
                  <div className="text-xs text-gray-300">{l.message}</div>
                  <div className="text-[10px] text-gray-300">
                    {format(new Date(l.fired_at), 'MMM d, yyyy HH:mm')}
                  </div>
                </div>
                {l.price && <span className="text-xs mono text-gray-300">${l.price.toFixed(2)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Alert">
        <form onSubmit={addAlert} className="space-y-3">
          {[
            ['Symbol', 'symbol', 'text', 'AAPL'],
            ['Value',  'value',  'number', '150'],
          ].map(([label, name, type, placeholder]) => (
            <div key={name}>
              <label className="text-xs text-gray-300 mb-1 block">{label}</label>
              <input
                required
                type={type}
                value={form[name]}
                onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
                placeholder={placeholder}
                step={type === 'number' ? 'any' : undefined}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
          ))}

          <div>
            <label className="text-xs text-gray-300 mb-1 block">Condition</label>
            <select
              value={form.condition}
              onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2"
            >
              <option value="above">Price above</option>
              <option value="below">Price below</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-300 mb-1 block">Type</label>
            <select
              value={form.alert_type}
              onChange={e => setForm(f => ({ ...f, alert_type: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2"
            >
              <option value="price">Price (repeating)</option>
              <option value="price_once">Price (once)</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-300 mb-1 block">Message (optional)</label>
            <input
              type="text"
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              placeholder="Custom message…"
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button type="submit" className="btn-primary w-full text-center">Create Alert</button>
        </form>
      </Modal>
    </div>
  );
}
