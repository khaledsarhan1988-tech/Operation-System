import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { Eye, EyeOff } from 'lucide-react';

const ROLE_HOME = { admin: '/admin', leader: '/leader', agent: '/agent' };

export default function Login() {
  const { t } = useTranslation();
  const { login, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ username: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated && user) {
      const from = location.state?.from?.pathname || ROLE_HOME[user.role] || '/agent';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, user]);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const loggedUser = await login(form.username, form.password);
      navigate(ROLE_HOME[loggedUser.role] || '/agent', { replace: true });
    } catch (err) {
      setError(t('auth.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-lg mb-4">
            <img src="/logo.png" alt="Logo" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-white text-xl font-bold text-center">{t('app.name')}</h1>
          <p className="text-white/60 text-sm mt-1">{t('app.tagline')}</p>
        </div>

        {/* Card */}
        <div className="bg-card rounded-2xl shadow-2xl p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-5">{t('auth.login')}</h2>

          {error && (
            <div className="bg-danger/10 text-danger text-sm p-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">{t('auth.username')}</label>
              <input
                type="text"
                autoComplete="username"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                className="input"
                required
              />
            </div>

            <div>
              <label className="label">{t('auth.password')}</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="input pe-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 text-text-secondary hover:text-text-primary"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? t('auth.loggingIn') : t('auth.loginBtn')}
            </button>
          </form>
        </div>

        <p className="text-center text-white/40 text-xs mt-6">
          Ahmed Hassan Academy © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
