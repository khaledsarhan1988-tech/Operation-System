import { Sparkles } from 'lucide-react';

/**
 * Small banner shown on trainer reports that exclude official-holiday days.
 * `dates` = array of YYYY-MM-DD strings (from the report's holiday_dates /
 * excluded_holidays). Renders nothing when there are no holidays in range.
 */
export default function HolidayBanner({ dates }) {
  const list = Array.isArray(dates) ? [...new Set(dates.filter(Boolean))].sort() : [];
  if (!list.length) return null;
  return (
    <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 flex items-start gap-2" dir="rtl">
      <Sparkles size={15} className="text-sky-600 mt-0.5 flex-shrink-0" />
      <p className="text-xs text-sky-800 leading-relaxed">
        تم استبعاد <b>{list.length}</b> يوم إجازة رسمية من الحساب:{' '}
        <span className="font-mono text-sky-700">{list.join('، ')}</span>
      </p>
    </div>
  );
}
