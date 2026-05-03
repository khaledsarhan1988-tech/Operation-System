import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Award, Plus, Filter } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';
import CustomGoalCard from '../../components/custom-goals/CustomGoalCard';
import GoalFormModal from '../../components/custom-goals/GoalFormModal';
import EvaluateGoalModal from '../../components/custom-goals/EvaluateGoalModal';

const STATUS_TABS = [
  { key: '',             label: 'الكل',          color: 'slate' },
  { key: 'pending',      label: '⏳ بانتظار التقييم', color: 'amber' },
  { key: 'achieved',     label: '✅ تم تحقيقها',   color: 'emerald' },
  { key: 'partially',    label: '🟡 جزئياً',       color: 'amber' },
  { key: 'not_achieved', label: '❌ لم تتحقق',     color: 'rose' },
];

export default function EvaluateGoals() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('pending'); // default to pending so leader sees what needs action
  const [agent, setAgent] = useState('');
  const [formState, setFormState]       = useState({ open: false, goal: null });
  const [evalState, setEvalState]       = useState({ open: false, goal: null });

  const { data, isLoading } = useQuery({
    queryKey: ['team-custom-goals', tab, agent],
    queryFn: () => api.get('/custom-goals/team', {
      params: { status: tab || undefined, agent: agent || undefined },
    }).then(r => r.data),
  });

  const { data: teamAgents = [] } = useQuery({
    queryKey: ['team-agents-for-goals-page'],
    queryFn: () => api.get('/custom-goals/team-agents').then(r => r.data),
  });

  const deleteM = useMutation({
    mutationFn: (id) => api.delete(`/custom-goals/team/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-custom-goals'] }),
  });

  const counts = data?.counts || { pending: 0, achieved: 0, partially: 0, not_achieved: 0, total: 0 };
  const rows = data?.rows || [];

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تقييم أهداف الفريق"
        subtitle="راجع أهداف موظفينك الإضافية وضع تقييمك مع نقاط القوة والتحسين"
        icon={Award}
        gradient="emerald"
        actions={
          <ModernButton
            variant="amber"
            icon={Plus}
            onClick={() => setFormState({ open: true, goal: null })}
          >
            هدف جديد لموظف
          </ModernButton>
        }
        stats={[
          { label: 'الإجمالي',     value: counts.total },
          { label: 'بانتظار التقييم', value: counts.pending },
          { label: 'تم تحقيقها',    value: counts.achieved },
          { label: 'لم تتحقق',     value: counts.not_achieved },
        ]}
      />

      {/* Filters */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
        {/* Status tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_TABS.map(t => {
            const active = tab === t.key;
            const c = t.key === '' ? counts.total : (counts[t.key] ?? 0);
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black transition-all border ${
                  active
                    ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-lg shadow-[#1e3a5f]/30'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {t.label}
                <span className={`text-[10px] px-1.5 rounded-full font-black ${
                  active ? 'bg-white/20 text-white' : 'bg-white text-gray-600'
                }`}>{c}</span>
              </button>
            );
          })}
        </div>

        {/* Agent filter */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100">
          <Filter size={13} className="text-gray-400" />
          <select
            value={agent}
            onChange={e => setAgent(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          >
            <option value="">كل الموظفين</option>
            {teamAgents.map(a => (
              <option key={a.id} value={a.full_name}>{a.full_name} — {a.department}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Goals list */}
      <SectionCard
        title={tab === 'pending' ? 'أهداف بانتظار تقييمك' : 'أهداف الفريق'}
        subtitle={`${rows.length} هدف`}
        icon={Award}
        accent="indigo"
      >
        {isLoading ? (
          <p className="text-center py-12 text-gray-400 text-sm font-bold">جاري التحميل...</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Award}
            accent="emerald"
            title={tab === 'pending' ? 'مفيش أهداف بانتظار تقييم' : 'لا توجد أهداف بهذه الحالة'}
            message={tab === 'pending'
              ? 'كل الأهداف اللي طلبها فريقك تم تقييمها 👏'
              : 'جرب فلتر آخر أو أضف هدف جديد لأحد موظفيك.'}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rows.map(g => (
              <CustomGoalCard
                key={g.id}
                goal={g}
                variant="leader"
                showAgentName
                onEvaluate={(goal) => setEvalState({ open: true, goal })}
                onEdit={(goal) => setFormState({ open: true, goal })}
                onDelete={(goal) => {
                  if (confirm(`حذف الهدف "${goal.title}" نهائياً؟`)) deleteM.mutate(goal.id);
                }}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <GoalFormModal
        open={formState.open}
        goal={formState.goal}
        mode="leader"
        onClose={() => setFormState({ open: false, goal: null })}
        onSuccess={() => setFormState({ open: false, goal: null })}
      />

      <EvaluateGoalModal
        open={evalState.open}
        goal={evalState.goal}
        onClose={() => setEvalState({ open: false, goal: null })}
        onSuccess={() => setEvalState({ open: false, goal: null })}
      />
    </div>
  );
}
