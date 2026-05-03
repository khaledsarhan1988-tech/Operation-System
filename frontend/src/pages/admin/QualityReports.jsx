import { ShieldCheck, Construction } from 'lucide-react';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';

export default function QualityReports() {
  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تقارير الجودة"
        subtitle="إحصائيات وتقارير قسم ضمان الجودة"
        icon={ShieldCheck}
        gradient="emerald"
      />

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm">
        <EmptyState
          icon={Construction}
          accent="emerald"
          title="قيد الإنشاء"
          message="هذه الصفحة قيد التطوير، وستتوفر التقارير الكاملة قريباً جداً."
        />
      </div>
    </div>
  );
}
