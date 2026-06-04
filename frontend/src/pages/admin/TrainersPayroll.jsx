import TrainerWorkHistory from './TrainerWorkHistory';

/**
 * مرتبات المدربين — PRIVATE owner-only page (System Admin), inside the
 * "مرتبات المدربين" section. It's the same view as "سجل عمل المدربين" plus a
 * "فئة المرتب" column. Access is locked to username='admin' at the route guard
 * and the sidebar; this is a thin wrapper so both pages stay in sync.
 */
export default function TrainersPayroll() {
  return <TrainerWorkHistory title="مرتبات المدربين" showSalaryCategory groupBySection />;
}
