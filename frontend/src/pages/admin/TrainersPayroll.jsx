import { Wallet, Lock, Construction } from 'lucide-react';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';

/**
 * مرتبات المدربين — PRIVATE owner-only page (System Admin), inside the
 * "مرتبات الموظفين" section. Placeholder for now; the actual content (per the
 * owner's instructions) will be added later. Locked to username='admin' at the
 * sidebar, the route guard, and (when a backend is added) the API.
 */
export default function TrainersPayroll() {
  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="مرتبات المدربين"
        subtitle="مرتبات الموظفين — صفحة خاصة بصاحب الحساب فقط"
        icon={Wallet}
        gradient="amber"
        actions={
          <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur border border-white/20 rounded-xl px-3 py-1.5 text-xs font-bold text-white">
            <Lock size={13} /> خاص بيك فقط
          </span>
        }
      />

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm">
        <EmptyState
          icon={Construction}
          accent="amber"
          title="قيد الإنشاء"
          message="الصفحة جاهزة — هيتحدد محتواها لاحقًا حسب طلبك."
        />
      </div>
    </div>
  );
}
