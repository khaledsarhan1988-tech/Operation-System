import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Search, Loader2, AlertTriangle, FileText } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';

// ─── METRIC CONFIG ─────────────────────────────────────────────────────────────
// Each entry describes: Arabic title, columns (key + label + optional renderer)
const METRIC_CONFIG = {
  'clients': {
    title: 'إجمالي العملاء',
    searchKeys: ['name', 'phone', 'email', 'group_name'],
    columns: [
      { key: 'name',              label: 'الاسم' },
      { key: 'phone',             label: 'الهاتف' },
      { key: 'email',             label: 'البريد الإلكتروني' },
      { key: 'group_name',        label: 'المجموعة' },
      { key: 'via_company',       label: 'المصدر' },
      { key: 'registration_time', label: 'تاريخ التسجيل' },
    ],
  },
  'batches': {
    title: 'المجموعات النشطة',
    searchKeys: ['group_name', 'course', 'trainers', 'coordinators'],
    columns: [
      { key: 'group_name',         label: 'الكود' },
      { key: 'course',             label: 'الدورة' },
      { key: 'dept_type',          label: 'القسم' },
      { key: 'trainers',           label: 'المدربون' },
      { key: 'coordinators',       label: 'المنسقون' },
      { key: 'trainee_count',      label: 'عدد الطلاب' },
      { key: 'scheduled_lectures', label: 'محاضرات مخططة' },
      { key: 'completed_lectures', label: 'محاضرات تمت' },
      { key: 'start_date',         label: 'بداية' },
      { key: 'end_date',           label: 'نهاية' },
    ],
  },
  'remarks': {
    title: 'إجمالي المهام',
    searchKeys: ['client_name', 'client_phone', 'task_type', 'assigned_to'],
    columns: [
      { key: 'client_name',  label: 'العميل' },
      { key: 'client_phone', label: 'الهاتف' },
      { key: 'task_type',    label: 'نوع المهمة' },
      { key: 'priority',     label: 'الأولوية' },
      { key: 'status',       label: 'الحالة' },
      { key: 'assigned_to',  label: 'المسؤول' },
      { key: 'assigned_by',  label: 'المُسنِد' },
      { key: 'added_at',     label: 'تاريخ الإضافة' },
      { key: 'sla_deadline', label: 'الموعد النهائي' },
    ],
  },
  'pending-remarks': {
    title: 'المهام قيد التنفيذ',
    searchKeys: ['client_name', 'client_phone', 'task_type', 'assigned_to'],
    columns: [
      { key: 'client_name',  label: 'العميل' },
      { key: 'client_phone', label: 'الهاتف' },
      { key: 'task_type',    label: 'نوع المهمة' },
      { key: 'priority',     label: 'الأولوية' },
      { key: 'status',       label: 'الحالة' },
      { key: 'assigned_to',  label: 'المسؤول' },
      { key: 'added_at',     label: 'تاريخ الإضافة' },
      { key: 'sla_deadline', label: 'الموعد النهائي' },
    ],
  },
  'overdue-remarks': {
    title: 'المهام المتأخرة',
    searchKeys: ['client_name', 'client_phone', 'task_type', 'assigned_to'],
    columns: [
      { key: 'client_name',  label: 'العميل' },
      { key: 'client_phone', label: 'الهاتف' },
      { key: 'task_type',    label: 'نوع المهمة' },
      { key: 'priority',     label: 'الأولوية' },
      { key: 'status',       label: 'الحالة' },
      { key: 'assigned_to',  label: 'المسؤول' },
      { key: 'added_at',     label: 'تاريخ الإضافة' },
      { key: 'sla_deadline', label: 'الموعد النهائي' },
    ],
  },
  'agents': {
    title: 'الوكلاء النشطون',
    searchKeys: ['full_name', 'username', 'department', 'management'],
    columns: [
      { key: 'full_name',   label: 'الاسم' },
      { key: 'username',    label: 'اسم المستخدم' },
      { key: 'department',  label: 'القسم' },
      { key: 'management',  label: 'الإدارة' },
      { key: 'language',    label: 'اللغة' },
      { key: 'created_at',  label: 'تاريخ الإنشاء' },
    ],
  },
  'absent-pending': {
    title: 'حالات الغياب المعلقة',
    searchKeys: ['student_name', 'phone', 'group_name'],
    columns: [
      { key: 'student_name',     label: 'الطالب' },
      { key: 'phone',            label: 'الهاتف' },
      { key: 'group_name',       label: 'المجموعة' },
      { key: 'date',             label: 'التاريخ' },
      { key: 'time',             label: 'الوقت' },
      { key: 'lecture_no',       label: 'رقم المحاضرة' },
      { key: 'follow_up_status', label: 'حالة المتابعة' },
    ],
  },
  'session-checks-today': {
    title: 'تحققات الجلسات اليوم',
    searchKeys: ['group_name', 'checked_by_name'],
    columns: [
      { key: 'group_name',           label: 'المجموعة' },
      { key: 'session_date',         label: 'تاريخ الجلسة' },
      { key: 'trainer_present',      label: 'المدرب', render: (v) => v === 1 ? '✓' : v === 0 ? '✗' : '—' },
      { key: 'student_present',      label: 'الطالب', render: (v) => v === 1 ? '✓' : v === 0 ? '✗' : '—' },
      { key: 'lecture_start_time',   label: 'بدء المحاضرة' },
      { key: 'recording_start_time', label: 'بدء التسجيل' },
      { key: 'actual_duration_min',  label: 'المدة (د)' },
      { key: 'notes',                label: 'ملاحظات' },
      { key: 'checked_by_name',      label: 'قام بالتحقق' },
      { key: 'checked_at',           label: 'وقت التحقق' },
    ],
  },
};

// Formatting helper for dates / booleans
function formatCell(value, col) {
  if (col.render) return col.render(value);
  if (value === null || value === undefined || value === '') return '—';
  // ISO-like datetime — shorten
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})/.test(value)) {
    return value.replace('T', ' ').slice(0, 16);
  }
  return String(value);
}

export default function DashboardDetail() {
  const { metric } = useParams();
  const [search, setSearch] = useState('');

  const cfg = METRIC_CONFIG[metric];

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-kpi-details', metric],
    queryFn: () => api.get(`/admin/kpis/details/${metric}`).then(r => r.data),
    enabled: Boolean(cfg),
    staleTime: 30 * 1000,
  });

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    if (!search.trim()) return data.rows;
    const q = search.toLowerCase();
    const keys = cfg?.searchKeys ?? [];
    return data.rows.filter(r =>
      keys.some(k => String(r[k] ?? '').toLowerCase().includes(q))
    );
  }, [data, search, cfg]);

  if (!cfg) {
    return (
      <div className="card p-8 text-center space-y-3">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />
        <p className="text-gray-700 font-semibold">مقياس غير معروف: {metric}</p>
        <Link to="/admin/dashboard" className="btn-outline inline-flex items-center gap-2 text-sm">
          <ArrowRight size={14} /> العودة للوحة التحكم
        </Link>
      </div>
    );
  }

  const searchEl = (
    <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1.5 min-w-[240px]">
      <Search size={13} className="text-white/70" />
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="بحث..."
        className="bg-transparent text-white placeholder-white/50 text-xs font-bold focus:outline-none flex-1"
      />
    </div>
  );

  const backEl = (
    <Link
      to="/admin/dashboard"
      className="inline-flex items-center justify-center p-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 transition-colors"
      title="العودة"
    >
      <ArrowRight size={14} className="text-white" />
    </Link>
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={cfg.title}
        subtitle={isLoading ? 'جاري التحميل...' : `${filtered.length} من إجمالي ${data?.count ?? 0}`}
        icon={FileText}
        gradient="navy"
        actions={<>{searchEl}{backEl}</>}
      />

      {/* Error */}
      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl p-4 font-bold flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          {error?.response?.data?.error || error?.message || 'حدث خطأ أثناء التحميل'}
        </div>
      )}

      {/* Table */}
      <SectionCard noBodyPad icon={FileText} title="البيانات التفصيلية" accent="indigo">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right" style={{ minWidth: '900px' }}>
            <thead className="bg-gray-50/60 border-b border-gray-100">
              <tr>
                {cfg.columns.map(c => (
                  <th key={c.key} className="px-4 py-3 text-xs font-black text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && (
                <tr>
                  <td colSpan={cfg.columns.length} className="px-4 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
                  </td>
                </tr>
              )}
              {!isLoading && !filtered.length && (
                <tr>
                  <td colSpan={cfg.columns.length} className="p-0">
                    <EmptyState
                      icon={Search}
                      accent="gray"
                      title="لا توجد بيانات"
                      message={search ? `لم يتم العثور على نتائج لـ "${search}"` : 'لا توجد سجلات لعرضها حالياً'}
                    />
                  </td>
                </tr>
              )}
              {!isLoading && filtered.map((row, i) => (
                <tr key={row.id ?? i} className="hover:bg-gray-50/40 transition-colors">
                  {cfg.columns.map(c => (
                    <td key={c.key} className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap" style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {formatCell(row[c.key], c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
