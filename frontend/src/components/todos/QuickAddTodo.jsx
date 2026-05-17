import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, X, Send, ListTodo, Zap } from 'lucide-react';
import api from '../../api/axios';

/**
 * Global Quick-Add Todo modal — opens with Ctrl/Cmd+K from anywhere.
 * Tiny one-line input that parses natural-ish input:
 *   - "اتصل بأحمد !!! غداً 5 مساءً" → urgent priority + due tomorrow + 17:00
 *   - "!" or "!!" or "!!!" trailing => priority high/urgent
 *   - "اليوم" / "بكرة" / "غداً" / DD/MM => due_date
 *   - "5 مساءً" / "10 صباحاً" / "15:30" => due_time
 */
export default function QuickAddTodo() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const qc = useQueryClient();

  // Global Ctrl/Cmd+K hotkey
  useEffect(() => {
    const handler = (e) => {
      const inField = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (!open && (e.key === 'n' || e.key === 'N') && !inField && (e.altKey)) {
        e.preventDefault();
        setOpen(true);
      }
      if (open && e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  function parseInput(raw) {
    let title = raw.trim();
    let priority = 'normal';
    let due_date = null;
    let due_time = null;

    // Priority via trailing !
    const exclMatch = title.match(/\s*(!{1,3})\s*$/);
    if (exclMatch) {
      const n = exclMatch[1].length;
      priority = n >= 3 ? 'urgent' : n === 2 ? 'high' : 'normal';
      title = title.slice(0, exclMatch.index).trim();
    }

    // Due date keywords
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (/\b(اليوم|today)\b/i.test(title)) {
      due_date = iso(today);
      title = title.replace(/\b(اليوم|today)\b/i, '').trim();
    } else if (/\b(بكرة|غداً|غدا|tomorrow)\b/i.test(title)) {
      const t = new Date(today); t.setDate(t.getDate() + 1);
      due_date = iso(t);
      title = title.replace(/\b(بكرة|غداً|غدا|tomorrow)\b/i, '').trim();
    } else {
      // DD/MM or DD-MM
      const dm = title.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
      if (dm) {
        const d = parseInt(dm[1]);
        const m = parseInt(dm[2]);
        const y = dm[3] ? (dm[3].length === 2 ? 2000 + parseInt(dm[3]) : parseInt(dm[3])) : today.getFullYear();
        const candidate = new Date(y, m - 1, d);
        if (!isNaN(candidate.getTime())) {
          due_date = iso(candidate);
          title = title.replace(dm[0], '').trim();
        }
      }
    }

    // Time: "5 مساءً" / "10 صباحاً" / "15:30" / "5pm"
    const tmAr = title.match(/\b(\d{1,2})(?::(\d{2}))?\s*(صباحاً|صباحا|ص|مساءً|مساء|م)\b/i);
    const tm24 = title.match(/\b(\d{1,2}):(\d{2})\b/);
    const tmAm = title.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (tmAr) {
      let h = parseInt(tmAr[1]);
      const min = tmAr[2] ? parseInt(tmAr[2]) : 0;
      const pm = /مساء|م/i.test(tmAr[3]);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
      due_time = `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      title = title.replace(tmAr[0], '').trim();
    } else if (tmAm) {
      let h = parseInt(tmAm[1]);
      const min = tmAm[2] ? parseInt(tmAm[2]) : 0;
      const pm = /pm/i.test(tmAm[3]);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
      due_time = `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      title = title.replace(tmAm[0], '').trim();
    } else if (tm24) {
      due_time = `${String(parseInt(tm24[1])).padStart(2,'0')}:${tm24[2]}`;
      title = title.replace(tm24[0], '').trim();
    }

    return { title: title.replace(/\s+/g,' ').trim(), priority, due_date, due_time };
  }

  async function submit(e) {
    e?.preventDefault?.();
    const parsed = parseInput(text);
    if (!parsed.title) return;
    setSubmitting(true);
    try {
      await api.post('/todos', parsed);
      setText('');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['todos'] });
    } catch (err) {
      console.error('quick-add failed:', err);
    } finally { setSubmitting(false); }
  }

  if (!open) return null;
  const parsed = parseInput(text);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] p-4" onClick={() => setOpen(false)}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <form onSubmit={submit}
        className="relative bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border-2 border-rose-200 animate-fadeIn"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 bg-gradient-to-r from-rose-500 to-pink-500 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={18} />
            <span className="font-bold text-sm">إضافة سريعة</span>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="p-1 hover:bg-white/20 rounded">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-2">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="اكتب المهمة... مثلاً: اتصل بأحمد غداً 5 مساءً !!"
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 text-base focus:border-rose-300 focus:ring-2 focus:ring-rose-100 outline-none"
            autoComplete="off"
          />
          <div className="flex items-center justify-between text-xs text-gray-500 px-1">
            <div className="flex flex-wrap gap-2">
              {parsed.title && parsed.title !== text.trim() && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100">
                  📝 {parsed.title}
                </span>
              )}
              {parsed.priority !== 'normal' && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold ${
                  parsed.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  <Zap size={10} /> {parsed.priority === 'urgent' ? 'عاجل' : 'مرتفع'}
                </span>
              )}
              {parsed.due_date && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                  📅 {parsed.due_date}
                </span>
              )}
              {parsed.due_time && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-100 text-violet-700">
                  🕐 {parsed.due_time}
                </span>
              )}
            </div>
            <span className="text-[10px] text-gray-400">⏎ للحفظ • Esc للإغلاق</span>
          </div>
          <div className="text-[10px] text-gray-400 px-1">
            💡 <strong>اختصارات:</strong> "!!" = مرتفع، "!!!" = عاجل، "غداً" / "اليوم" / "DD/MM" للتاريخ، "5 مساءً" / "15:30" للوقت
          </div>
        </div>
      </form>
    </div>
  );
}
