import { useEffect, useState } from 'react';
import { ExternalLink, Newspaper } from 'lucide-react';
import api from '../../api/client.js';

function timeAgo(pubDate) {
  if (!pubDate) return '';
  const t = new Date(pubDate).getTime();
  if (isNaN(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NewsFeed({ topic, title = 'Latest news' }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/macro/news', { params: { topic } })
      .then(r => { if (alive) setItems(r.data.items || []); })
      .catch(e => { if (alive) setError(e.response?.data?.error || e.message); });
    return () => { alive = false; };
  }, [topic]);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Newspaper size={13} className="text-gray-400" />
        <h2 className="text-xs font-semibold text-gray-200">{title}</h2>
        <span className="text-[9px] text-gray-500 ml-auto">Google News · 30-min cache</span>
      </div>

      {error && <div className="text-[11px] text-red-400">{error}</div>}
      {items == null && !error && (
        <div className="text-[11px] text-gray-400 animate-pulse py-3">Loading headlines…</div>
      )}
      {items?.length === 0 && !error && (
        <div className="text-[11px] text-gray-400 py-3">No recent headlines found.</div>
      )}

      <ul className="divide-y divide-gray-800/60">
        {items?.map((it, i) => (
          <li key={i}>
            <a
              href={it.link} target="_blank" rel="noopener noreferrer"
              className="group flex items-start gap-2 py-2 hover:bg-gray-800/30 rounded px-1 -mx-1 transition-colors"
            >
              <ExternalLink size={11} className="text-gray-500 mt-0.5 shrink-0 group-hover:text-blue-400" />
              <span className="min-w-0">
                <span className="text-[11.5px] text-gray-200 group-hover:text-blue-300 leading-snug block">{it.title}</span>
                <span className="text-[9px] text-gray-500">
                  {it.source}{it.source && it.pubDate ? ' · ' : ''}{timeAgo(it.pubDate)}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
