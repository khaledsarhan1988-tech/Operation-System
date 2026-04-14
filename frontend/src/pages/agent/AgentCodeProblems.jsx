import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';

const PROB_STATUS = {
  new:         { label: 'جديد',       cls: 'bg-red-100 text-red-700 border-red-200' },
  reported:    { label: 'تم الإبلاغ', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  in_progress: { label: 'قيد الحل',   cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  wont_repeat: { label: 'لن تتكرر',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  exception:   { label: 'استثناء',    cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  resolved:    { label: 'تم حلها',    cls: 'bg-green-100 text-green-700 border-green-200' },
};

function ProblemRow({ p, session, statusMap }) {
  const stored = statusMap[`${p.group_name}|${p.problem_type}|${session}`];
  const sk  = p._resolved_status ?? stored?.status ?? 'new';
  const cfg = PROB_STATUS[sk] ?? PROB_STATUS.new;
  return (
    <div className="flex items-center gap-3 p-3 bg-surface rounded-lg border border-border">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-text-primary truncate">{p.group_name}</p>
        <p className="text-xs text-text-secondary mt-0.5">{p.problem_type}</p>
      </div>
      <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium flex-shrink-0 ${cfg.cls}`}>
        {cfg.label}
      </span>
    </div>
  );
}

export default function AgentCodeProblems() {
  const { user } = useAuth();

  const { data: codeProblems, isLoading } = useQuery({
    queryKey: ['agent-code-problems', user?.id],
    queryFn: () => api.get('/reports/code-problems', {
      params: { coordinator_user_id: user?.id },
    }).then(r => r.data),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: statusData } = useQuery({
    queryKey: ['problem-statuses'],
    queryFn: () => api.get('/reports/problem-statuses').then(r => r.data),
    staleTime: 60 * 1000,
  });

  const statusMap = {};
  (statusData ?? []).forEach(s => {
    statusMap[`${s.group_name}|${s.problem_type}|${s.session_type}`] = s;
  });

  const mainProbs = codeProblems?.main_problems ?? [];
  const zoomProbs = codeProblems?.zoom_problems ?? [];
  const total = mainProbs.length + zoomProbs.length;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="text-danger" />
        <h1 className="text-xl font-bold text-text-primary">أكواد بها مشكلة</h1>
        {total > 0 && (
          <span className="bg-red-100 text-red-700 text-sm font-bold px-3 py-0.5 rounded-full border border-red-200">
            {total}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="card text-center text-text-secondary py-10">جاري التحميل...</div>
      ) : total === 0 ? (
        <div className="card text-center text-text-secondary py-12">
          <p className="text-4xl mb-3">✅</p>
          <p className="font-medium">لا توجد مشاكل في مجموعاتك</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Main Lectures Problems */}
          {mainProbs.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="font-semibold text-text-primary">مشاكل المحاضرات الرئيسية</h2>
                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full border border-red-200">
                  {mainProbs.length}
                </span>
              </div>
              <div className="space-y-2">
                {mainProbs.map((p, i) => (
                  <ProblemRow key={i} p={p} session="main" statusMap={statusMap} />
                ))}
              </div>
            </div>
          )}

          {/* Zoom Call Problems */}
          {zoomProbs.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="font-semibold text-text-primary">مشاكل الزووم كول</h2>
                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full border border-red-200">
                  {zoomProbs.length}
                </span>
              </div>
              <div className="space-y-2">
                {zoomProbs.map((p, i) => (
                  <ProblemRow key={i} p={p} session="side" statusMap={statusMap} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
