import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

/**
 * Enrollment — empty skeleton (same shape as Customer Services Department):
 * a header + a tab per department (جينرال / سيمي برايفت / برايفت).
 *
 * URL: /subscriptions/enrollment
 * Content is intentionally empty for now — to be built together later.
 */

const ALL_DEPTS = ['General', 'Semi', 'Private'];

const DEPT_META = {
  General: { label: 'جينرال',      color: 'cyan'    },
  Semi:    { label: 'سيمي برايفت', color: 'emerald' },
  Private: { label: 'برايفت',      color: 'violet'  },
};

export default function Enrollment() {
  const [activeDept, setActiveDept] = useState('General');
  const meta = DEPT_META[activeDept] || { label: activeDept, color: 'violet' };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHero
        title="Enrollment"
        subtitle="صفحة قيد الإنشاء"
        icon={GraduationCap}
        color={meta.color}
      />

      {/* Department tabs */}
      <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
        {ALL_DEPTS.map(d => (
          <button
            key={d}
            onClick={() => setActiveDept(d)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
              activeDept === d
                ? 'border-violet-600 text-violet-700 bg-violet-50'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {DEPT_META[d]?.label || d}
          </button>
        ))}
      </div>

      <SectionCard title={meta.label} icon={GraduationCap} className="mt-4">
        <div className="p-12 text-center text-slate-400">
          الصفحة فاضية — هنبنيها مع بعض 👌
        </div>
      </SectionCard>
    </div>
  );
}
