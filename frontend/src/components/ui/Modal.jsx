import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, subtitle, icon: Icon, children, size = 'md' }) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      const onKey = e => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('keydown', onKey);
      return () => {
        document.body.style.overflow = '';
        document.removeEventListener('keydown', onKey);
      };
    }
  }, [open, onClose]);

  if (!open) return null;

  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal-content ${sizes[size]}`}>
        <div
          className="flex items-start justify-between gap-3 px-6 py-5 border-b border-border"
          style={{ background: 'linear-gradient(180deg, #FAFBFC 0%, #FFFFFF 100%)' }}
        >
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {Icon && (
              <div
                className="inline-flex items-center justify-center h-10 w-10 rounded-xl flex-shrink-0 mt-0.5"
                style={{
                  background: 'linear-gradient(180deg, #6366F1 0%, #4F46E5 100%)',
                  boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.25), 0 4px 12px -2px rgba(79, 70, 229, 0.4)',
                  color: '#FFFFFF',
                }}
              >
                <Icon size={18} strokeWidth={2.4} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-extrabold text-text-primary tracking-tight truncate">
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs text-text-secondary mt-0.5 font-medium">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-icon-ghost flex-shrink-0"
            aria-label="Close modal"
          >
            <X size={18} strokeWidth={2.4} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
