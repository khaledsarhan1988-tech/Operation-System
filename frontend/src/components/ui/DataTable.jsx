import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

export default function DataTable({
  columns,   // [{ key, label, render?, sortable? }]
  data,
  total,
  page,
  limit = 25,
  onPageChange,
  loading,
  emptyMsg,
  onRowClick,
}) {
  const { t } = useTranslation();
  const totalPages = Math.ceil(total / limit);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="relative">
          <div className="h-12 w-12 rounded-full border-4 border-slate-100" />
          <div className="absolute inset-0 h-12 w-12 rounded-full border-4 border-transparent border-t-primary animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.key} className="table-header">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-16">
                  <div className="inline-flex flex-col items-center gap-3 text-text-muted">
                    <div className="h-14 w-14 rounded-full bg-slate-100 flex items-center justify-center">
                      <Inbox size={24} className="text-slate-400" strokeWidth={2} />
                    </div>
                    <p className="text-sm font-semibold">
                      {emptyMsg || t('common.noData')}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              data?.map((row, i) => (
                <tr
                  key={row.id ?? i}
                  className={`table-row ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map(col => (
                    <td key={col.key} className="table-cell">
                      {col.render ? col.render(row[col.key], row) : row[col.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card-muted">
          <span className="text-xs font-semibold text-text-secondary">
            {t('common.page')} <span className="font-extrabold text-text-primary">{page}</span> {t('common.of')}{' '}
            <span className="font-extrabold text-text-primary">{totalPages}</span>
            <span className="text-text-muted"> · </span>
            <span className="font-bold text-text-primary tabular-nums">{total}</span> {t('common.rows')}
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="btn-icon-ghost disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} className="rtl:flip" strokeWidth={2.4} />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="btn-icon-ghost disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight size={16} className="rtl:flip" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
