import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function StatCard({ label, value, icon: Icon, color = 'primary', subtitle, to, onClick }) {
  const colors = {
    primary: 'bg-primary/10 text-primary',
    accent:  'bg-accent/10 text-accent',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger:  'bg-danger/10 text-danger',
    gray:    'bg-gray-100 text-gray-500',
  };

  const clickable = Boolean(to || onClick);

  const inner = (
    <>
      {Icon && (
        <div className={`p-3 rounded-xl ${colors[color]} flex-shrink-0`}>
          <Icon size={22} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-text-secondary text-sm truncate">{label}</p>
        <p className="text-2xl font-bold text-text-primary leading-tight">
          {value ?? <span className="text-border text-lg">—</span>}
        </p>
        {subtitle && <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>}
      </div>
      {clickable && (
        <ChevronLeft
          size={16}
          className="text-gray-300 group-hover:text-primary transition-colors flex-shrink-0"
        />
      )}
    </>
  );

  const baseCls = 'card flex items-center gap-4';
  const hoverCls = clickable
    ? 'group cursor-pointer hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5 transition-all text-right w-full'
    : '';

  if (to) {
    return (
      <Link to={to} className={`${baseCls} ${hoverCls}`}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${baseCls} ${hoverCls}`}>
        {inner}
      </button>
    );
  }
  return <div className={baseCls}>{inner}</div>;
}
