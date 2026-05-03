import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Trash2, CheckCheck, BarChart2, Award, Target as TargetIcon, Info } from 'lucide-react';
import api from '../../api/axios';

const TYPE_ICONS = {
  snapshot_frozen:    BarChart2,
  achievement_earned: Award,
  target_changed:     TargetIcon,
  system:             Info,
  custom:             Info,
};
const TYPE_COLORS = {
  snapshot_frozen:    'text-violet-500 bg-violet-50',
  achievement_earned: 'text-amber-500 bg-amber-50',
  target_changed:     'text-emerald-500 bg-emerald-50',
  system:             'text-blue-500 bg-blue-50',
  custom:             'text-gray-500 bg-gray-50',
};

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso.replace(' ', 'T') + (iso.includes('T') ? '' : '+02:00')).getTime();
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'الآن';
  const m = Math.floor(s / 60);
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  const d = Math.floor(h / 24);
  if (d < 7) return `منذ ${d} يوم`;
  return new Date(iso).toLocaleDateString('ar-EG');
}

/**
 * NotificationsBell — bell icon with unread badge + dropdown panel.
 * Polls every 60s; refetches on window focus.
 */
export default function NotificationsBell({ chipStyle }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications', { params: { limit: 30 } }).then(r => r.data),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const unread = data?.unread || 0;
  const rows = data?.rows || [];

  const readM = useMutation({
    mutationFn: (id) => api.put(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAllM = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const deleteM = useMutation({
    mutationFn: (id) => api.delete(`/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function handleClick(n) {
    if (!n.is_read) readM.mutate(n.id);
    if (n.link) {
      setOpen(false);
      nav(n.link);
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="relative inline-flex items-center justify-center h-10 w-10 rounded-xl text-slate-300 hover:text-white transition-all"
        style={chipStyle}
        title="الإشعارات"
      >
        <Bell size={18} strokeWidth={2.2} />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center"
            style={{ border: '2px solid #0F172A' }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-full mt-2 left-0 rtl:right-0 rtl:left-auto w-96 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-fadeIn"
          dir="rtl"
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
            <p className="text-sm font-black text-gray-800">الإشعارات</p>
            {unread > 0 && (
              <button
                onClick={() => readAllM.mutate()}
                className="inline-flex items-center gap-1 text-[11px] font-black text-blue-600 hover:text-blue-700"
              >
                <CheckCheck size={12} /> قراءة الكل
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {rows.length === 0 ? (
              <div className="p-8 text-center">
                <Bell size={32} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm font-black text-gray-500">لا توجد إشعارات</p>
                <p className="text-[11px] text-gray-400 font-bold mt-1">سنخبرك هنا بكل تحديث جديد</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {rows.map(n => {
                  const Icon = TYPE_ICONS[n.type] || Info;
                  const colorCls = TYPE_COLORS[n.type] || TYPE_COLORS.system;
                  return (
                    <div key={n.id}
                         className={`flex items-start gap-3 p-3 hover:bg-gray-50/70 transition-colors ${n.is_read ? '' : 'bg-blue-50/40'}`}>
                      <div className={`p-1.5 rounded-lg flex-shrink-0 ${colorCls}`}>
                        <Icon size={14} />
                      </div>
                      <button
                        onClick={() => handleClick(n)}
                        className="flex-1 text-right min-w-0"
                      >
                        <p className={`text-xs font-black ${n.is_read ? 'text-gray-700' : 'text-gray-900'} line-clamp-2`}>
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-[11px] text-gray-500 font-bold mt-0.5 line-clamp-2">{n.body}</p>
                        )}
                        <p className="text-[10px] text-gray-400 font-bold mt-1">{timeAgo(n.created_at)}</p>
                      </button>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        {!n.is_read && (
                          <button
                            onClick={() => readM.mutate(n.id)}
                            className="p-1 hover:bg-blue-100 rounded text-blue-500"
                            title="تحديد كمقروء"
                          >
                            <Check size={11} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteM.mutate(n.id)}
                          className="p-1 hover:bg-red-100 rounded text-red-400"
                          title="حذف"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
