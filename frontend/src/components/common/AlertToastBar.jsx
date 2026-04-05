import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';

export default function AlertToastBar() {
  const esRef = useRef(null);

  useEffect(() => {
    const es = new EventSource('/api/alerts/stream');
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'alert') {
          toast.custom((t) => (
            <div
              className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-sm w-full bg-gray-900 border border-yellow-600 rounded-xl shadow-lg p-3`}
              onClick={() => toast.dismiss(t.id)}
            >
              <div className="flex items-start gap-2">
                <div className="text-yellow-400 text-sm">🔔</div>
                <div>
                  <div className="text-xs font-semibold text-yellow-400">{data.symbol} Alert</div>
                  <div className="text-xs text-gray-300 mt-0.5">{data.message}</div>
                </div>
              </div>
            </div>
          ), { duration: 8000 });
        }
      } catch {}
    };

    es.onerror = () => {
      // SSE reconnects automatically
    };

    return () => {
      es.close();
    };
  }, []);

  return null;
}
