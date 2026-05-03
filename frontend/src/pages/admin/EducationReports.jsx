import { GraduationCap, Construction } from 'lucide-react';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';

export default function EducationReports() {
  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تقارير الإدارة التعليمية"
        subtitle="إحصائيات وتقارير قسم التعليم"
        icon={GraduationCap}
        gradient="violet"
      />

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm">
        <EmptyState
          icon={Construction}
          accent="violet"
          title="قيد الإنشاء"
          message="هذه الصفحة قيد التطوير، وستتوفر التقارير الكاملة قريباً جداً."
        />
      </div>
    </div>
  );
}
