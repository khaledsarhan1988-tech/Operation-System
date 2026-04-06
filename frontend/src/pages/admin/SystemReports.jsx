import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Download, BarChart2, Users, BookOpen, ClipboardList } from 'lucide-react';
import api from '../../api/axios';

const REPORT_TYPES = [
  {
    key: 'side-sessions',
    icon: BookOpen,
    labelAr: 'تقرير الجلسات الجانبية',
    labelEn: 'Side Sessions Report',
    descAr: 'جميع بيانات الجلسات الجانبية وحالة التحقق',
    descEn: 'All side session data with check status',
    color: 'text-blue-600 bg-blue-50',
  },
  {
    key: 'remarks',
    icon: ClipboardList,
    labelAr: 'تقرير الملاحظات',
    labelEn: 'Remarks Report',
    descAr: 'الملاحظات مع حالة SLA والملاحظات المضافة',
    descEn: 'Remarks with SLA status and agent notes',
    color: 'text-orange-600 bg-orange-50',
  },
  {
    key: 'absent',
    icon: Users,
    labelAr: 'تقرير الغيابات',
    labelEn: 'Absent Students Report',
    descAr: 'الطلاب الغائبون وحالة المتابعة',
    descEn: 'Absent students with follow-up status',
    color: 'text-red-600 bg-red-50',
  },
  {
    key: 'team-performance',
    icon: BarChart2,
    labelAr: 'تقرير أداء الفريق',
    labelEn: 'Team Performance Report',
    descAr: 'إنتاجية الوكلاء ومعدلات الإغلاق',
    descEn: 'Agent productivity and closure rates',
    color: 'text-green-600 bg-green-50',
  },
];

function KpiCard({ label, value, sub, color = 'text-primary' }) {
  return (
    <div className="card flex flex-col gap-1">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function SystemReports() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const [downloading, setDownloading] = useState(null);

  const { data: kpis, isLoading } = useQuery({
    queryKey: ['admin-kpis'],
    queryFn: () => api.get('/admin/kpis').then(r => r.data),
  });

  const downloadReport = async (key) => {
    setDownloading(key);
    try {
      const res = await api.get(`/export/${key}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${key}-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {isAr ? 'تقارير النظام' : 'System Reports'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {isAr
            ? 'تنزيل تقارير Excel الشاملة لجميع بيانات النظام'
            : 'Download comprehensive Excel reports for all system data'}
        </p>
      </div>

      {/* KPI summary */}
      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-3 uppercase tracking-wide">
          {isAr ? 'ملخص النظام' : 'System Summary'}
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="card animate-pulse h-24 bg-gray-100" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label={isAr ? 'إجمالي المتدربين' : 'Total Trainees'}
              value={kpis?.totalTrainees}
              color="text-primary"
            />
            <KpiCard
              label={isAr ? 'المجموعات النشطة' : 'Active Batches'}
              value={kpis?.activeBatches}
              color="text-blue-600"
            />
            <KpiCard
              label={isAr ? 'الملاحظات المفتوحة' : 'Open Remarks'}
              value={kpis?.openRemarks}
              color="text-orange-600"
            />
            <KpiCard
              label={isAr ? 'الغيابات غير المتابعة' : 'Unresolved Absences'}
              value={kpis?.unresolvedAbsent}
              color="text-red-600"
            />
            <KpiCard
              label={isAr ? 'الملاحظات العاجلة' : 'Urgent Remarks'}
              value={kpis?.urgentRemarks}
              color="text-red-700"
              sub={isAr ? 'تنتهي خلال 24 ساعة' : 'Due within 24h'}
            />
            <KpiCard
              label={isAr ? 'جلسات جانبية اليوم' : "Today's Side Sessions"}
              value={kpis?.todaySideSessions}
              color="text-green-600"
            />
            <KpiCard
              label={isAr ? 'إجمالي الموظفين' : 'Total Employees'}
              value={kpis?.totalEmployees}
              color="text-gray-700"
            />
            <KpiCard
              label={isAr ? 'آخر مزامنة' : 'Last Sync'}
              value={kpis?.lastSyncDate ? new Date(kpis.lastSyncDate).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB') : '—'}
              color="text-gray-500"
            />
          </div>
        )}
      </div>

      {/* Report cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-3 uppercase tracking-wide">
          {isAr ? 'تصدير التقارير' : 'Export Reports'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {REPORT_TYPES.map((report) => {
            const Icon = report.icon;
            const isActive = downloading === report.key;
            return (
              <div key={report.key} className="card flex items-start gap-4">
                <div className={`p-3 rounded-xl ${report.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-800">
                    {isAr ? report.labelAr : report.labelEn}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {isAr ? report.descAr : report.descEn}
                  </p>
                </div>
                <button
                  onClick={() => downloadReport(report.key)}
                  disabled={isActive}
                  className="btn-primary flex items-center gap-2 text-sm flex-shrink-0"
                >
                  <Download className={`w-4 h-4 ${isActive ? 'animate-bounce' : ''}`} />
                  {isActive
                    ? (isAr ? 'جارٍ...' : 'Exporting...')
                    : (isAr ? 'تصدير' : 'Export')}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-medium mb-1">{isAr ? 'ملاحظة:' : 'Note:'}</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>
            {isAr
              ? 'التقارير تشمل جميع البيانات حتى تاريخ التصدير'
              : 'Reports include all data up to the export date'}
          </li>
          <li>
            {isAr
              ? 'بيانات التحقق من الجلسات الجانبية لا تُحذف تلقائياً عند إعادة الرفع'
              : 'Side session check data is never deleted automatically on re-upload'}
          </li>
          <li>
            {isAr
              ? 'يمكن فقط للمسؤول حذف بيانات التحقق من الجلسات الجانبية'
              : 'Only Admin can delete side session check records'}
          </li>
        </ul>
      </div>
    </div>
  );
}
