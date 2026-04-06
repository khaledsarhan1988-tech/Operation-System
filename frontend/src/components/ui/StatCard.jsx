export default function StatCard({ label, value, icon: Icon, color = 'primary', subtitle }) {
  const colors = {
    primary: 'bg-primary/10 text-primary',
    accent:  'bg-accent/10 text-accent',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger:  'bg-danger/10 text-danger',
    gray:    'bg-gray-100 text-gray-500',
  };
  return (
    <div className="card flex items-center gap-4">
      {Icon && (
        <div className={`p-3 rounded-xl ${colors[color]}`}>
          <Icon size={22} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-text-secondary text-sm truncate">{label}</p>
        <p className="text-2xl font-bold text-text-primary leading-tight">
          {value ?? <span className="text-border text-lg">—</span>}
        </p>
        {subtitle && <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}
