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

/**
 * UserAvatar — renders the user's uploaded profile picture if available,
 * otherwise falls back to the existing gradient + first-initial circle.
 *
 * Props:
 *   name         — full_name (used for initial + deterministic gradient)
 *   avatarUrl    — filename from users.avatar_url (nullable)
 *   size         — 'sm' | 'md' | 'lg' | 'xl' (matches global .avatar-* classes)
 *   className    — extra classes
 */
export default function UserAvatar({ name = '', avatarUrl = null, size = 'md', className = '' }) {
  const [errored, setErrored] = useState(false);
  const initial = (name?.[0] || '?').toUpperCase();
  const gradient = gradientFor(name);
  const sizeCls = `avatar-${size}`;
  const showImage = avatarUrl && !errored;

  if (showImage) {
    return (
      <div className={`avatar ${sizeCls} overflow-hidden p-0 ${className}`}>
        <img
          src={avatarSrc(avatarUrl)}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      </div>
    );
  }
  return (
    <div className={`avatar ${sizeCls} bg-gradient-to-br ${gradient} ${className}`}>
      {initial}
    </div>
  );
}
