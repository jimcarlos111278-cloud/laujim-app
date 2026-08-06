import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginAdmin, loginTenant, getAuth, clearAuth } from '../utils/auth';
import { getBase } from '../utils/config';
import { getViewMode, setViewMode } from '../utils/viewMode';
import { refreshAllFromServer, startCloudPolling, startDataVersionPolling } from '../api';
import { Building2, Monitor, Smartphone, KeyRound, User, ShieldCheck } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('admin');
  const [vm, setVm] = useState(getViewMode());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [checkingStoredSession, setCheckingStoredSession] = useState(() => Boolean(getAuth()));

  // A Render deploy or a restored database can invalidate server sessions.
  // Never redirect based only on localStorage: verify the token first so the
  // owner can sign in again instead of being trapped in an unauthorized loop.
  useEffect(() => {
    const existing = getAuth();
    if (!existing?.token) {
      setCheckingStoredSession(false);
      return;
    }
    let cancelled = false;
    fetch(getBase() + '/data-version', { headers: { 'x-auth-token': existing.token }, signal: AbortSignal.timeout(5000) })
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          navigate(existing.role === 'admin' ? '/dashboard' : '/mi-apto', { replace: true });
        } else {
          clearAuth();
          setCheckingStoredSession(false);
          setError('Tu sesión venció tras el cambio del servidor. Inicia sesión de nuevo.');
        }
      })
      .catch(() => {
        if (!cancelled) setCheckingStoredSession(false);
      });
    return () => { cancelled = true; };
  }, [navigate]);

  function changeViewMode(mode) {
    setViewMode(mode);
    setVm(mode);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = tab === 'admin'
        ? await loginAdmin(username, password)
        : await loginTenant(username, password);
      if (result.ok) {
        // After an SPA login the PrivateApp startup effect has already returned
        // (it only runs once on mount, when there was no session). Pull the
        // server data and start the sync/polling loops here so the dashboard is
        // never empty and other devices' changes still arrive in real time.
        try {
          if (result.role === 'admin') await refreshAllFromServer();
          startCloudPolling(15000);
          startDataVersionPolling(3000);
        } catch { /* sync is best-effort; navigation proceeds anyway */ }
        navigate(result.role === 'admin' ? '/dashboard' : '/mi-apto', { replace: true });
      } else {
        setError(result.error || 'Error al iniciar sesión');
      }
    } catch {
      setError('Error de conexión');
    }
    setLoading(false);
  }

  if (checkingStoredSession) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Verificando sesión…</div>;
  }

  return (
    <div className="login-scene min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4 overflow-hidden">
      <div className="login-orb login-orb-one" aria-hidden="true" />
      <div className="login-orb login-orb-two" aria-hidden="true" />
      <div className="login-content w-full max-w-md relative z-10">
        <div className="text-center mb-8 login-enter login-enter-1">
          <div className="login-logo inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-600/25">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Gestión de Apartamentos</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Inicia sesión para continuar</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-6 login-enter login-enter-2">
          <button onClick={() => changeViewMode('horizontal')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${vm === 'horizontal' ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 hover:border-blue-300'}`}>
            <Monitor className="w-4 h-4" /> PC
          </button>
          <span className="text-gray-300 dark:text-gray-600 text-xs">MODO</span>
          <button onClick={() => changeViewMode('vertical')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${vm === 'vertical' ? 'bg-emerald-600 text-white shadow-lg scale-105' : 'bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 hover:border-emerald-300'}`}>
            <Smartphone className="w-4 h-4" /> Móvil
          </button>
        </div>

        <div className="login-card bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden login-enter login-enter-3">
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button onClick={() => { setTab('admin'); setError(''); }} className={`flex-1 py-3.5 text-sm font-medium text-center transition-colors ${tab === 'admin' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/20' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              <ShieldCheck className="w-4 h-4 mx-auto mb-1" /> Administrador
            </button>
            <button onClick={() => { setTab('tenant'); setError(''); }} className={`flex-1 py-3.5 text-sm font-medium text-center transition-colors ${tab === 'tenant' ? 'text-emerald-600 border-b-2 border-emerald-600 bg-emerald-50/50 dark:bg-emerald-900/20' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              <User className="w-4 h-4 mx-auto mb-1" /> Inquilino
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {tab === 'admin' ? (
              <>
                <div>
                  <label htmlFor="login-admin-username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Usuario</label>
                  <input id="login-admin-username" name="username" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" autoComplete="username" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <div>
                  <label htmlFor="login-admin-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña</label>
                  <input id="login-admin-password" name="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="login-tenant-apartment" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Apartamento</label>
                  <input id="login-tenant-apartment" name="apartment" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Ej: 102, 201, 301" autoComplete="off" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none" required />
                </div>
                <div>
                  <label htmlFor="login-tenant-document" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cédula</label>
                  <input id="login-tenant-document" name="documentId" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Número de cédula" autoComplete="off" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none" required />
                </div>
              </>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                <KeyRound className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
              {loading ? 'Entrando...' : 'Iniciar Sesión'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6 login-enter login-enter-4">
          Los inquilinos ingresan con el número de apartamento y su número de cédula
        </p>
      </div>
    </div>
  );
}
