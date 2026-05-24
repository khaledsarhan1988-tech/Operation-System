import { useState } from 'react';
import {
  User, Lock, Eye, EyeOff, KeyRound, Save, Loader2,
  CheckCircle, AlertCircle, Shield, Mail, Briefcase,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import { useAuth } from '../../auth/AuthContext';
import UserAvatar from '../../components/ui/UserAvatar';

// ─── ROLE / DEPT / MANAGEMENT LABELS ───────────────────────────────────────────
const ROLE_LABEL = {
  admin: 'مسؤول',
  leader: 'قائد',
  agent: 'موظف',
  enrollment: 'تسجيل',
  enrollment_leader: 'قائد التسجيل',
};

const MANAGEMENT_LABEL = {
  'All': 'جميع الإدارات',
  'Customer Services': 'خدمة العملاء',
  'Education': 'التعليم',
  'Quality': 'الجودة',
};

// ─── INFO ROW ──────────────────────────────────────────────────────────────────
function InfoRow({ icon, label, value }) {
  const IconComp = icon;
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50/60 border border-gray-100">
      <div className="p-2 bg-white rounded-lg border border-gray-200">
        <IconComp size={15} className="text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-500 font-bold uppercase">{label}</p>
        <p className="text-sm font-semibold text-gray-900 truncate">{value || '—'}</p>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function Profile() {
  const { user } = useAuth();

  // ── change-password form state
  const [current,  setCurrent]  = useState('');
  const [next,     setNext]     = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showCur,  setShowCur]  = useState(false);
  const [showNew,  setShowNew]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  // ── client-side validation
  const tooShort        = next.length > 0 && next.length < 6;
  const sameAsCurrent   = next.length > 0 && current.length > 0 && next === current;
  const mismatch        = confirm.length > 0 && next !== confirm;
  const canSave =
    !!current && !!next && !!confirm &&
    !tooShort && !sameAsCurrent && !mismatch && !saving;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const res = await api.post('/auth/change-password', {
        current_password: current,
        new_password:     next,
      });
      setSuccess(res.data?.message || 'تم تغيير كلمة السر بنجاح. يفضّل تسجيل دخول من جديد.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      const status = err?.response?.status;
      const backendMsg = err?.response?.data?.error;
      if (status === 401)      setError('كلمة السر الحالية غير صحيحة');
      else if (backendMsg)     setError(backendMsg);
      else if (!err?.response) setError('تعذّر الاتصال بالسيرفر');
      else                     setError('حدث خطأ غير متوقع. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="صفحتي الشخصية"
        subtitle={user?.full_name || ''}
        icon={User}
        gradient="navy"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── User info ── */}
        <div className="lg:col-span-1 bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-6 flex flex-col items-center gap-3 bg-gradient-to-b from-slate-50 to-white border-b border-gray-100">
            <UserAvatar user={user} size={80} />
            <div className="text-center">
              <p className="text-base font-black text-gray-900">{user?.full_name}</p>
              <p className="text-xs text-gray-500 mt-0.5" dir="ltr">@{user?.username}</p>
            </div>
          </div>
          <div className="p-4 space-y-2.5">
            <InfoRow icon={Shield}    label="الدور"    value={ROLE_LABEL[user?.role] || user?.role} />
            <InfoRow icon={Briefcase} label="القسم"   value={user?.department} />
            <InfoRow icon={Mail}      label="الإدارة" value={MANAGEMENT_LABEL[user?.management] || user?.management} />
            <InfoRow icon={Briefcase} label="الـ Line" value={user?.line} />
          </div>
        </div>

        {/* ── Change password ── */}
        <div className="lg:col-span-2 bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2.5">
            <div className="p-2 bg-violet-100 rounded-lg">
              <KeyRound size={16} className="text-violet-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">تغيير كلمة السر</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                لازم تدخل كلمة السر الحالية للتأكيد. بعد التغيير هتحتاج تسجل دخول من جديد على باقي الأجهزة.
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="p-6 space-y-4">
            {/* Current password */}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">كلمة السر الحالية</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showCur ? 'text' : 'password'}
                  value={current}
                  onChange={e => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-white border border-gray-200 rounded-xl pr-10 pl-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                  placeholder="••••••••"
                  dir="ltr"
                />
                <button type="button" onClick={() => setShowCur(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showCur ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">كلمة السر الجديدة</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showNew ? 'text' : 'password'}
                  value={next}
                  onChange={e => setNext(e.target.value)}
                  autoComplete="new-password"
                  className={`w-full bg-white border rounded-xl pr-10 pl-10 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                    tooShort || sameAsCurrent
                      ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
                      : 'border-gray-200 focus:ring-violet-500/30 focus:border-violet-500'
                  }`}
                  placeholder="6 أحرف على الأقل"
                  dir="ltr"
                />
                <button type="button" onClick={() => setShowNew(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {tooShort && (
                <p className="text-[11px] text-red-600 mt-1.5">⚠️ كلمة السر يجب أن تكون 6 أحرف على الأقل</p>
              )}
              {sameAsCurrent && (
                <p className="text-[11px] text-red-600 mt-1.5">⚠️ كلمة السر الجديدة لا يمكن أن تكون نفس الحالية</p>
              )}
            </div>

            {/* Confirm */}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">تأكيد كلمة السر الجديدة</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showNew ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className={`w-full bg-white border rounded-xl pr-10 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                    mismatch
                      ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
                      : 'border-gray-200 focus:ring-violet-500/30 focus:border-violet-500'
                  }`}
                  placeholder="أعد كتابة كلمة السر الجديدة"
                  dir="ltr"
                />
              </div>
              {mismatch && (
                <p className="text-[11px] text-red-600 mt-1.5">⚠️ كلمة التأكيد لا تطابق كلمة السر الجديدة</p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle size={14} className="text-red-600 flex-shrink-0" />
                <p className="text-xs text-red-700 font-medium">{error}</p>
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                <CheckCircle size={14} className="text-emerald-600 flex-shrink-0" />
                <p className="text-xs text-emerald-700 font-medium">{success}</p>
              </div>
            )}

            <button type="submit" disabled={!canSave}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'جاري الحفظ...' : 'تغيير كلمة السر'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
