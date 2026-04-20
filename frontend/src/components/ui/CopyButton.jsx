import { useState, useRef } from 'react';
import { Copy, Check, X } from 'lucide-react';
import { copyText } from '../../utils/clipboard';

/**
 * CopyButton — click-to-copy with visual feedback.
 *
 * Props:
 *  - text:      string to copy
 *  - children:  JSX/text rendered inside the button
 *  - className: extra Tailwind classes
 *  - showIcon:  show the copy icon (default: true)
 *  - title:     hover tooltip (default: "انقر للنسخ")
 *  - dir:       direction override for the button
 *  - size:      icon size (default: 12)
 */
export default function CopyButton({
  text,
  children,
  className = '',
  showIcon = true,
  title = 'انقر للنسخ',
  dir,
  size = 12,
  stopPropagation = true,
  ...rest
}) {
  const [state, setState] = useState('idle'); // 'idle' | 'copied' | 'error'
  const timerRef = useRef(null);

  const handle = async (e) => {
    if (stopPropagation) e.stopPropagation();
    e.preventDefault();
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'error');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState('idle'), 1600);
  };

  const feedbackIcon =
    state === 'copied' ? <Check size={size} className="text-emerald-600" />
    : state === 'error'  ? <X     size={size} className="text-red-500"    />
    : showIcon          ? <Copy  size={size} className="opacity-50"      />
    : null;

  const feedbackTitle =
    state === 'copied' ? 'تم النسخ ✓'
    : state === 'error' ? 'فشل النسخ — اضغط باستخدام الماوس لتحديد النص ونسخه يدوياً'
    : title;

  return (
    <button
      type="button"
      onClick={handle}
      title={feedbackTitle}
      dir={dir}
      className={`inline-flex items-center gap-1 cursor-copy ${className}`}
      {...rest}
    >
      {children}
      {feedbackIcon}
    </button>
  );
}
