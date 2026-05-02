import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function SearchBar({ value, onChange, placeholder, className = '' }) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(value || '');

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => onChange(local), 400);
    return () => clearTimeout(timer);
  }, [local]);

  useEffect(() => { setLocal(value || ''); }, [value]);

  return (
    <div className={`relative ${className}`}>
      <Search
        size={16}
        strokeWidth={2.4}
        className="absolute start-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
      />
      <input
        type="text"
        value={local}
        onChange={e => setLocal(e.target.value)}
        placeholder={placeholder || t('common.search')}
        className="input ps-10 pe-9"
      />
      {local && (
        <button
          type="button"
          onClick={() => { setLocal(''); onChange(''); }}
          className="absolute end-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-6 w-6 rounded-md
                     text-text-muted hover:bg-card-muted hover:text-text-primary transition-colors"
          aria-label="Clear search"
        >
          <X size={14} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
