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
      <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-secondary" />
      <input
        type="text"
        value={local}
        onChange={e => setLocal(e.target.value)}
        placeholder={placeholder || t('common.search')}
        className="input ps-9 pe-8"
      />
      {local && (
        <button
          onClick={() => { setLocal(''); onChange(''); }}
          className="absolute end-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 rounded"
        >
          <X size={14} className="text-text-secondary" />
        </button>
      )}
    </div>
  );
}
