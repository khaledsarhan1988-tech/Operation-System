import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} className="table-header text-start">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data?.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-12 text-text-secondary">
                {emptyMsg || t('common.noData')}
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

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="text-sm text-text-secondary">
            {t('common.page')} {page} {t('common.of')} {totalPages} · {total} {t('common.rows')}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} className="rtl:flip" />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} className="rtl:flip" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
