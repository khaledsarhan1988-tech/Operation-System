import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, AlertCircle, CheckCircle2, XCircle, RotateCcw, BookOpen, Users, ShieldCheck } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

const DEPT_LABEL = { General: 'عام', Private: 'خاص', Semi: 'شبه خاص' };

export default function DeletedGroupsReview() {
  const qc = useQueryClient();

  const sug = useQuery({
    queryKey: ['cs-deleted-suggestions'],
    queryFn: async () => (await api.get('/cs/deleted-groups/suggestions')).data,
  });
  const confirmed = useQuery({
    queryKey: ['cs-deleted-list'],
    queryFn: async () => (await api.get('/cs/deleted-groups')).data,
  });

  const decide = useMutation({
    mutationFn: (body) => api.post('/cs/deleted-groups/decide', body),
    onSuccess: () => { qc.invalidateQueries(['cs-deleted-suggestions']); qc.invalidateQueries(['cs-deleted-list']); },
  });
  const clear = useMutation({
    mutationFn: (canonKey) => api.delete(`/cs/deleted-groups/${encodeURIComponent(canonKey)}`),
    onSuccess: () => { qc.invalidateQueries(['cs-deleted-suggestions']); qc.invalidateQueries(['cs-deleted-list']); },
  });

  const suggestions = sug.data?.suggestions || [];
  const confirmedList = (confirmed.data?.groups || []).filter(g => g.status === 'confirmed');

  return (
    <div className="space-y-6 pb-12" dir="rtl">
      <PageHero
        title="مراجعة المجموعات المحذوفة"
        subtitle="مجموعات في ملفات المستويات مالهاش مقابل في «All Batches» — أكّد المحذوف فعلًا ليتم استبعاده من حساب المستويات"
        icon={Trash2}
        gradient="linear-gradient(135deg, #b91c1c 0%, #f59e0b 100%)"
      />

      {/* How it works */}
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm flex items-start gap-2">
        <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          الاستبعاد بيشتغل <b>بس على اللي تأكّده هنا</b>. المجموعات اللي ليها تطابق واضح في «All Batches» متحسبة عادي ومش بتظهر.
          عمود «محاضرات؟» تلميح: <b>ليها محاضرات</b> غالبًا حقيقية، <b>بدون محاضرات</b> غالبًا محذوفة — بس القرار قرارك.
        </div>
      </div>

      {/* Confirmed summary */}
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="w-5 h-5 text-red-600" />
          <h3 className="font-bold text-gray-800">مؤكَّد إنها محذوفة (مستبعَدة الآن): {confirmedList.length}</h3>
        </div>
        {confirmedList.length === 0 ? (
          <p className="text-gray-400 text-sm">لسه مفيش مجموعات مؤكَّدة.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {confirmedList.map(g => (
              <span key={g.canon_key} className="inline-flex items-center gap-1.5 bg-red-50 text-red-700 border border-red-200 rounded-full px-3 py-1 text-xs">
                {g.label}
                <button onClick={() => clear.mutate(g.canon_key)} title="إلغاء (رجّعها محسوبة)" className="hover:text-red-900">
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Suggestions table */}
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <h3 className="font-bold text-gray-800">مجموعات للمراجعة: {suggestions.length}</h3>
          </div>
          <span className="text-xs text-gray-500">
            {suggestions.filter(s => !s.has_lectures).length} بدون محاضرات · {suggestions.filter(s => s.has_lectures).length} ليها محاضرات
          </span>
        </div>

        {sug.isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">جارٍ التحميل…</div>
        ) : sug.isError ? (
          <div className="m-4 rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            فشل التحميل: {sug.error?.response?.data?.error || sug.error?.message}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-green-500" />
            مفيش مجموعات محتاجة مراجعة — كله متطابق مع «All Batches».
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-2 text-right font-semibold">المجموعة</th>
                  <th className="px-3 py-2 text-center font-semibold">القسم</th>
                  <th className="px-3 py-2 text-center font-semibold">العملاء</th>
                  <th className="px-3 py-2 text-center font-semibold">محاضرات؟</th>
                  <th className="px-3 py-2 text-center font-semibold">القرار</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {suggestions.map(s => (
                  <tr key={s.canon_key} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{s.label}</td>
                    <td className="px-3 py-2.5 text-center text-gray-600">{DEPT_LABEL[s.dept] || s.dept || '—'}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-flex items-center gap-1 font-bold text-gray-700">
                        <Users className="w-3.5 h-3.5 text-gray-400" />{s.clients}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {s.has_lectures
                        ? <span className="inline-flex items-center gap-1 text-[11px] text-sky-700 bg-sky-50 rounded-full px-2 py-0.5"><BookOpen className="w-3 h-3" />ليها محاضرات</span>
                        : <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">بدون</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => decide.mutate({ canon_key: s.canon_key, label: s.label, dept: s.dept, status: 'confirmed' })}
                          className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2.5 py-1.5">
                          <XCircle className="w-3.5 h-3.5" />محذوفة
                        </button>
                        <button
                          onClick={() => decide.mutate({ canon_key: s.canon_key, label: s.label, dept: s.dept, status: 'rejected' })}
                          className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg px-2.5 py-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />سليمة
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
