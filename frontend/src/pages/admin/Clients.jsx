import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Search, Calendar, Filter, X, ChevronLeft, ChevronRight,
  Eye, RefreshCw, CheckCircle, XCircle, Clock, DollarSign,
  Phone, User, Building2, Tag, CreditCard, Hash, AlertTriangle,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB');
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { hour12: false });
}
function fmtAmount(amount, currency) {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (isNaN(n)) return amount;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim();
}

// ─── STATUS / TYPE BADGES ─────────────────────────────────────────────────────
const STATUS_STYLE = {
  pending:  { label: 'Pending',  bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-300',   icon: Clock      },
  approved: { label: 'Approved', bg: 'bg-blue-100',    text: 'text-blue-800',    border: 'border-blue-300',    icon: CheckCircle},
  paid:     { label: 'Paid',     bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300', icon: DollarSign },
  rejected: { label: 'Rejected', bg: 'bg-rose-100',    text: 'text-rose-800',    border: 'border-rose-300',    icon: XCircle    },
};
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || { label: status || '—', bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300', icon: Tag };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${s.bg} ${s.text} ${s.border}`}>
      <Icon size={12} />
      {s.label}
    </span>
  );
}

const TYPE_STYLE = {
  new_enrollment: { label: 'New Enrollment', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  renewal:        { label: 'Renewal',        bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200'    },
  upgrade:        { label: 'Upgrade',        bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200'  },
  installment:    { label: 'Installment',    bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
  recommendation: { label: 'Recommendation', bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200'    },
  session:        { label: 'Session',        bg: 'bg-pink-50',    text: 'text-pink-700',    border: 'border-pink-200'    },
  refund:         { label: 'Refund',         bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200'    },
};
function TypeBadge({ type }) {
  const s = TYPE_STYLE[type] || { label: type || '—', bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold border ${s.bg} ${s.text} ${s.border}`}>
      {s.label}
    </span>
  );
}

// ─── DETAILS MODAL ────────────────────────────────────────────────────────────
function DetailsModal({ txId, onClose }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['clients-finance', 'tx', txId],
    queryFn: () => api.get(`/clients-finance/transactions/${txId}`).then(r => r.data),
    enabled: !!txId,
  });

  if (!txId) return null;

  const tx = data?.transaction || {};
  const installments = data?.installments || [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Eye size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black">تفاصيل العملية</h2>
              <p className="text-xs text-white/80 font-mono mt-0.5" dir="ltr">{txId}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/15 rounded-xl transition">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-5">
          {isLoading && (
            <div className="text-center py-10">
              <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-3" />
              <p className="text-sm font-bold text-gray-500">جارٍ تحميل التفاصيل...</p>
            </div>
          )}

          {isError && (
            <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <p className="text-sm font-bold text-rose-700">فشل تحميل التفاصيل</p>
            </div>
          )}

          {!isLoading && !isError && (
            <>
              {/* Section 1: بيانات العميل والصفقة */}
              <SectionCard title="بيانات العميل والصفقة" icon={User} accent="indigo">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <Field label="اسم العميل" value={tx.client_name} mono={false} />
                  <Field label="التليفون" value={tx.client_phone} mono />
                  <Field label="تاريخ العملية" value={fmtDate(tx.date)} mono />
                  <Field label="نوع العملية" value={<TypeBadge type={tx.type} />} />
                  <Field label="الحالة" value={<StatusBadge status={tx.status} />} />
                  <Field label="المبلغ" value={<span className="font-black text-emerald-700">{fmtAmount(tx.amount, tx.currency)}</span>} />
                  <Field label="الفئة" value={tx.category} />
                  <Field label="نوع الصفقة" value={tx.deal_type} />
                  <Field label="المحافظة" value={tx.governorate} />
                  <Field label="المنتج" value={tx.product_name} />
                </div>
              </SectionCard>

              {/* Section 2: الخصم */}
              {(tx.discount_label || tx.discount_pct) && (
                <SectionCard title="الخصم" icon={Tag} accent="amber">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <Field label="نوع الخصم" value={tx.discount_label} />
                    <Field label="نسبة الخصم" value={tx.discount_pct ? `${tx.discount_pct}%` : '—'} />
                  </div>
                </SectionCard>
              )}

              {/* Section 3: الموافقة */}
              <SectionCard title="الموافقة والمسؤولين" icon={CheckCircle} accent="emerald">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <Field label="المندوب (Agent)" value={tx.agent_name} />
                  <Field label="القسم" value={tx.department_name} />
                  <Field label="أنشأها" value={tx.created_by_name} />
                  <Field label="وافق عليها" value={tx.approved_by_name} />
                  <Field label="وقت الموافقة" value={fmtDateTime(tx.approved_at)} mono />
                  {tx.status === 'rejected' && (
                    <Field label="سبب الرفض" value={tx.rejection_reason || '—'} className="md:col-span-2" />
                  )}
                </div>
              </SectionCard>

              {/* Section 4: Installments */}
              {tx.has_installments || installments.length > 0 ? (
                <SectionCard
                  title={`الأقساط (${installments.length})`}
                  icon={CreditCard}
                  accent="violet"
                  noBodyPad
                >
                  {installments.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-6">لا توجد أقساط مسجلة</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" dir="ltr">
                        <thead className="bg-gray-50">
                          <tr className="text-xs text-gray-600 font-bold">
                            <th className="px-4 py-2 text-left">#</th>
                            <th className="px-4 py-2 text-left">Amount</th>
                            <th className="px-4 py-2 text-left">Due Date</th>
                            <th className="px-4 py-2 text-left">Paid</th>
                            <th className="px-4 py-2 text-left">Paid At</th>
                            <th className="px-4 py-2 text-left">Note</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {installments.map((ins, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-4 py-2 font-bold">{ins.installment_no || idx + 1}</td>
                              <td className="px-4 py-2 font-mono">{fmtAmount(ins.amount, tx.currency)}</td>
                              <td className="px-4 py-2 font-mono">{fmtDate(ins.due_date)}</td>
                              <td className="px-4 py-2">
                                {ins.paid
                                  ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-bold"><CheckCircle size={12}/>Paid</span>
                                  : <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-bold"><Clock size={12}/>Due</span>}
                              </td>
                              <td className="px-4 py-2 font-mono text-xs">{fmtDateTime(ins.paid_at)}</td>
                              <td className="px-4 py-2 text-gray-600">{ins.note || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </SectionCard>
              ) : null}

              {/* Section 5: ملاحظات وحقول إضافية */}
              {(tx.note || tx.job || tx.classify) && (
                <SectionCard title="ملاحظات وحقول إضافية" icon={Tag} accent="cyan">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {tx.job      && <Field label="Job"      value={tx.job} />}
                    {tx.classify && <Field label="Classify" value={tx.classify} />}
                    {tx.note     && <Field label="Note"     value={tx.note} className="md:col-span-2" />}
                  </div>
                </SectionCard>
              )}

              {/* Section 6: الأوقات */}
              <SectionCard title="التتبع الزمني" icon={Clock} accent="slate">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <Field label="Created" value={fmtDateTime(tx.created_at)} mono />
                  <Field label="Updated" value={fmtDateTime(tx.updated_at)} mono />
                  <Field label="Synced"  value={fmtDateTime(tx.synced_at)}  mono />
                </div>
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono = false, className = '' }) {
  return (
    <div className={className}>
      <p className="text-xs text-gray-500 font-bold mb-1">{label}</p>
      <div className={`text-gray-900 ${mono ? 'font-mono text-sm' : 'font-semibold'}`} dir={mono ? 'ltr' : 'auto'}>
        {value || <span className="text-gray-300">—</span>}
      </div>
    </div>
  );
}

// ─── FILTER BAR ───────────────────────────────────────────────────────────────
function FilterBar({ filters, setFilters, filterOpts, onReset }) {
  const update = (k, v) => setFilters(f => ({ ...f, [k]: v, page: 1 }));

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="بحث بالاسم أو التليفون..."
            value={filters.q}
            onChange={(e) => update('q', e.target.value)}
            className="w-full pl-3 pr-9 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
          />
        </div>

        {/* Status */}
        <select
          value={filters.status}
          onChange={(e) => update('status', e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        >
          <option value="">كل الحالات</option>
          {(filterOpts?.statuses || []).map(s => (
            <option key={s} value={s}>{STATUS_STYLE[s]?.label || s}</option>
          ))}
        </select>

        {/* Type */}
        <select
          value={filters.type}
          onChange={(e) => update('type', e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        >
          <option value="">كل الأنواع</option>
          {(filterOpts?.types || []).map(t => (
            <option key={t} value={t}>{TYPE_STYLE[t]?.label || t}</option>
          ))}
        </select>

        {/* Agent */}
        <select
          value={filters.agent}
          onChange={(e) => update('agent', e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        >
          <option value="">كل المندوبين</option>
          {(filterOpts?.agents || []).map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        {/* Department */}
        <select
          value={filters.department}
          onChange={(e) => update('department', e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        >
          <option value="">كل الأقسام</option>
          {(filterOpts?.departments || []).map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* Currency */}
        <select
          value={filters.currency}
          onChange={(e) => update('currency', e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        >
          <option value="">كل العملات</option>
          {(filterOpts?.currencies || []).map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* From */}
        <div className="relative">
          <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="date"
            value={filters.from}
            onChange={(e) => update('from', e.target.value)}
            className="w-full pl-3 pr-9 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
            placeholder="من"
          />
        </div>

        {/* To */}
        <div className="relative">
          <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => update('to', e.target.value)}
            className="w-full pl-3 pr-9 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
            placeholder="إلى"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition"
        >
          <X size={14} />
          مسح الفلاتر
        </button>
        <p className="text-xs text-gray-500 font-bold">
          <Filter size={12} className="inline ml-1" />
          الفلاتر تُطبَّق تلقائياً
        </p>
      </div>
    </div>
  );
}

// ─── PAGINATION ───────────────────────────────────────────────────────────────
function Pagination({ page, pages, total, onPageChange }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 mt-4 px-2">
      <p className="text-xs font-bold text-gray-500">
        صفحة <span className="text-gray-800">{page}</span> من <span className="text-gray-800">{pages}</span>
        <span className="mx-2 text-gray-300">·</span>
        إجمالي <span className="text-gray-800">{total.toLocaleString('en-US')}</span> عملية
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="p-2 border border-gray-200 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 transition"
        >
          <ChevronRight size={16} />
        </button>
        <span className="px-3 py-1.5 text-sm font-bold bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-200 min-w-[40px] text-center">
          {page}
        </span>
        <button
          onClick={() => onPageChange(Math.min(pages, page + 1))}
          disabled={page >= pages}
          className="p-2 border border-gray-200 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 transition"
        >
          <ChevronLeft size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function Clients() {
  const [filters, setFilters] = useState({
    q: '', status: '', type: '', agent: '', department: '', currency: '',
    from: '', to: '', page: 1, limit: 50,
  });
  const [selectedTxId, setSelectedTxId] = useState(null);

  // Build query params dynamically
  const params = useMemo(() => {
    const p = { page: filters.page, limit: filters.limit };
    if (filters.q)          p.q          = filters.q;
    if (filters.status)     p.status     = filters.status;
    if (filters.type)       p.type       = filters.type;
    if (filters.agent)      p.agent      = filters.agent;
    if (filters.department) p.department = filters.department;
    if (filters.currency)   p.currency   = filters.currency;
    if (filters.from)       p.from       = filters.from;
    if (filters.to)         p.to         = filters.to;
    return p;
  }, [filters]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['clients-finance', 'transactions', params],
    queryFn: () => api.get('/clients-finance/transactions', { params }).then(r => r.data),
    keepPreviousData: true,
  });

  const { data: filterOpts } = useQuery({
    queryKey: ['clients-finance', 'filters'],
    queryFn: () => api.get('/clients-finance/filters').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: summary } = useQuery({
    queryKey: ['clients-finance', 'summary'],
    queryFn: () => api.get('/clients-finance/summary').then(r => r.data),
    staleTime: 60 * 1000,
  });

  const onReset = () => setFilters({
    q: '', status: '', type: '', agent: '', department: '', currency: '',
    from: '', to: '', page: 1, limit: 50,
  });

  const transactions = data?.transactions || [];
  const total = data?.total || 0;
  const pages = data?.pages || 1;

  return (
    <div className="p-6 space-y-5" dir="rtl">
      {/* Page Header */}
      <PageHero
        title="Clients — العملاء"
        subtitle="كل العمليات المالية من Center App"
        icon={Users}
        gradient="violet"
        stats={[
          { label: 'إجمالي العمليات', value: summary?.total_tx       || 0, icon: Hash       },
          { label: 'عملاء فريدين',    value: summary?.unique_clients || 0, icon: User       },
          { label: 'Approved',         value: summary?.approved       || 0, icon: CheckCircle},
          { label: 'Paid',             value: summary?.paid           || 0, icon: DollarSign },
          { label: 'Pending',          value: summary?.pending        || 0, icon: Clock      },
          { label: 'Rejected',         value: summary?.rejected       || 0, icon: XCircle    },
        ]}
      />

      {/* Filters */}
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        filterOpts={filterOpts}
        onReset={onReset}
      />

      {/* Table */}
      <SectionCard
        title="قائمة العمليات"
        subtitle={isFetching ? 'جارٍ التحديث...' : `${total.toLocaleString('en-US')} عملية`}
        icon={CreditCard}
        accent="indigo"
        actions={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            تحديث
          </button>
        }
        noBodyPad
      >
        {isLoading ? (
          <div className="text-center py-16">
            <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin mx-auto mb-4" />
            <p className="text-sm font-bold text-gray-500">جارٍ تحميل العمليات...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-gray-500">لا توجد عمليات مطابقة للفلاتر</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir="ltr">
              <thead className="bg-gradient-to-b from-gray-50 to-white border-b-2 border-gray-200">
                <tr className="text-xs text-gray-700 font-black uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-left">Phone</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-left">Agent</th>
                  <th className="px-4 py-3 text-left">Department</th>
                  <th className="px-4 py-3 text-left">Updated</th>
                  <th className="px-4 py-3 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-indigo-50/40 transition">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{fmtDate(tx.date)}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">{tx.client_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{tx.client_phone || '—'}</td>
                    <td className="px-4 py-3"><TypeBadge type={tx.type} /></td>
                    <td className="px-4 py-3 text-gray-700">{tx.product_name || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">
                      {fmtAmount(tx.amount, tx.currency)}
                    </td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={tx.status} /></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{tx.agent_name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{tx.department_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-gray-500">{fmtDateTime(tx.updated_at)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setSelectedTxId(tx.id)}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition"
                        title="عرض التفاصيل"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Pagination
        page={filters.page}
        pages={pages}
        total={total}
        onPageChange={(p) => setFilters(f => ({ ...f, page: p }))}
      />

      <DetailsModal txId={selectedTxId} onClose={() => setSelectedTxId(null)} />
    </div>
  );
}
