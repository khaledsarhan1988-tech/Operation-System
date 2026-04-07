import { ShieldCheck } from 'lucide-react';

export default function QualityReports() {
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-4 animate-fadeIn">
      <div className="h-16 w-16 rounded-2xl bg-success/10 flex items-center justify-center">
        <ShieldCheck size={32} className="text-success" />
      </div>
      <h1 className="text-xl font-bold text-gray-800">تقارير الجودة</h1>
      <p className="text-gray-500 text-sm">قيد الإنشاء — سيتم إضافة التقارير قريباً</p>
    </div>
  );
}
