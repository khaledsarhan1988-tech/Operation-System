import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Trash2, Upload, ImagePlus } from 'lucide-react';
import Modal from './Modal';
import ModernButton from './ModernButton';
import UserAvatar, { avatarSrc } from './UserAvatar';
import api from '../../api/axios';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * AvatarUploadDialog — upload / replace / delete a user's profile picture.
 *
 * Props:
 *   open      — boolean
 *   onClose   — () => void
 *   name      — display name (used by fallback avatar + dialog title)
 *   avatarUrl — current filename or null
 *   endpoint  — { upload: 'POST url', remove: 'DELETE url' }
 *   onSaved   — (newAvatarUrl|null) => void   called after upload OR delete
 */
export default function AvatarUploadDialog({ open, onClose, name, avatarUrl, endpoint, onSaved }) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null); // local object URL while pending upload
  const [pendingFile, setPendingFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setPendingFile(null);
    setError('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const handleClose = () => {
    reset();
    onClose?.();
  };

  const handlePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting same file
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      setError('الصورة يجب أن تكون JPG أو PNG أو WebP');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('حجم الصورة أكبر من 2 ميجابايت');
      return;
    }
    setError('');
    setPendingFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleUpload = async () => {
    if (!pendingFile) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('avatar', pendingFile);
      const { data } = await api.post(endpoint.upload, form);
      onSaved?.(data.avatar_url || null);
      reset();
      onClose?.();
    } catch (e) {
      setError(e.response?.data?.error || 'تعذر رفع الصورة');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!avatarUrl) return;
    if (!window.confirm('هل تريد حذف الصورة الشخصية؟')) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(endpoint.remove);
      onSaved?.(null);
      reset();
      onClose?.();
    } catch (e) {
      setError(e.response?.data?.error || 'تعذر حذف الصورة');
    } finally {
      setBusy(false);
    }
  };

  // Live preview source: pending file > current avatar > fallback
  const previewSrc = previewUrl || (avatarUrl ? avatarSrc(avatarUrl) : null);

  return (
    <Modal open={open} onClose={handleClose} title="الصورة الشخصية" subtitle={name} icon={Paperclip} size="sm">
      <div className="space-y-5" dir="rtl">
        <div className="flex flex-col items-center gap-3">
          {previewSrc ? (
            <span
              className="rounded-full overflow-hidden ring-2 ring-primary/30 shadow-lg inline-block"
              style={{ width: 128, height: 128, flexShrink: 0 }}
            >
              <img
                src={previewSrc}
                alt={name}
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </span>
          ) : (
            <UserAvatar name={name} size="preview" className="shadow-lg" />
          )}
          <p className="text-xs text-text-secondary">JPG / PNG / WebP — الحد الأقصى 2 ميجابايت</p>
        </div>

        {error && (
          <div className="text-sm text-danger bg-danger/10 p-3 rounded-lg text-center">{error}</div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handlePick}
        />

        <div className="flex flex-wrap items-center justify-center gap-2">
          <ModernButton
            variant="primary"
            icon={ImagePlus}
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            اختر صورة
          </ModernButton>

          {pendingFile && (
            <ModernButton
              variant="success"
              icon={Upload}
              onClick={handleUpload}
              disabled={busy}
            >
              {busy ? 'جاري الرفع...' : 'رفع الصورة'}
            </ModernButton>
          )}

          {avatarUrl && !pendingFile && (
            <ModernButton
              variant="danger"
              icon={Trash2}
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? '...' : 'حذف الصورة'}
            </ModernButton>
          )}
        </div>
      </div>
    </Modal>
  );
}
