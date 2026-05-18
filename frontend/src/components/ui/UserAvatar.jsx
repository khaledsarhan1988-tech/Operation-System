import { useState } from 'react';

const AVATAR_GRADIENTS = [
  'from-indigo-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
  'from-sky-500 to-indigo-600',
  'from-teal-500 to-emerald-600',
];

function gradientFor(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export function avatarSrc(filename) {
  if (!filename) return null;
  return `${API_BASE}/auth/avatars/${encodeURIComponent(filename)}`;
}

// Explicit pixel dimensions — we use inline styles instead of Tailwind size
// classes because the .avatar utility uses `inline-flex`, which can let an
// <img> child stretch the container to its natural size in some browsers /
// table layouts. Inline width/height + display:block on the <img> guarantees
// the rendered size regardless of the source image's intrinsic dimensions.
const SIZE_MAP = {
  sm:      { wh: 32,  text: 14 },
  md:      { wh: 40,  text: 16 },
  lg:      { wh: 48,  text: 18 },
  xl:      { wh: 64,  text: 22 },
  preview: { wh: 128, text: 44 },
};

/**
 * UserAvatar — renders the user's uploaded profile picture if available,
 * otherwise falls back to the gradient + first-initial circle.
 *
 * Props:
 *   name      — full_name (used for initial + deterministic gradient)
 *   avatarUrl — filename from users.avatar_url (nullable)
 *   size      — 'sm' | 'md' | 'lg' | 'xl' | 'preview'
 *   className — extra classes (NOT for sizing — pick a size prop instead)
 */
export default function UserAvatar({ name = '', avatarUrl = null, size = 'md', className = '' }) {
  const [errored, setErrored] = useState(false);
  const initial = (name?.[0] || '?').toUpperCase();
  const gradient = gradientFor(name);
  const { wh, text } = SIZE_MAP[size] || SIZE_MAP.md;
  const showImage = avatarUrl && !errored;

  const wrapperStyle = {
    width: wh,
    height: wh,
    minWidth: wh,
    minHeight: wh,
    maxWidth: wh,
    maxHeight: wh,
    borderRadius: '9999px',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'inline-block',
    verticalAlign: 'middle',
    boxSizing: 'border-box',
  };

  if (showImage) {
    return (
      <span className={`ring-2 ring-white/30 shadow-sm ${className}`} style={wrapperStyle}>
        <img
          src={avatarSrc(avatarUrl)}
          alt={name}
          draggable={false}
          onError={() => setErrored(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </span>
    );
  }

  return (
    <span
      className={`bg-gradient-to-br ${gradient} ring-2 ring-white/30 text-white font-extrabold select-none ${className}`}
      style={{
        ...wrapperStyle,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: text,
        lineHeight: 1,
      }}
    >
      {initial}
    </span>
  );
}
