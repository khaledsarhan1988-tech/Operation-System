import { GraduationCap } from 'lucide-react';

export default function EducationReports() {
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-4 animate-fadeIn">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <GraduationCap size={32} className="text-primary" />
      </div>
      <h1 className="text-xl font-bold text-gray-800">تقارير الإدارة التعليمية</h1>
      <p className="text-gray-500 text-sm">قيد الإنشاء — سيتم إضافة التقارير قريباً</p>
    </div>
  );
}
