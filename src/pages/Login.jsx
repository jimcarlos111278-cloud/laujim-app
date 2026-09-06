import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginAdmin, loginTenant, getAuth } from '../utils/auth';
import { getBase } from '../utils/config';
import { refreshAllFromServer, startCloudPolling, startDataVersionPolling } from '../api';
import { KeyRound, User, ShieldCheck, Home, Eye, EyeOff, Lock, ArrowRight } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('admin');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');

  const [checkingStoredSession, setCheckingStoredSession] = useState(() => Boolean(getAuth()));

  // A Render deploy or server cold start can briefly delay session validation.
  // Never destroy local session tokens on transient network issues; verify with graceful fallback.
  useEffect(() => {
    const existing = getAuth();
    if (!existing?.token) {
      setCheckingStoredSession(false);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 2;
    async function verifySession() {
      while (attempts < maxAttempts && !cancelled) {
        try {
          const res = await fetch(getBase() + '/data-version', {
            headers: { 'x-auth-token': existing.token },
            signal: AbortSignal.timeout(6000),
          });
          if (cancelled) return;
          if (res.ok) {
            navigate(existing.role === 'admin' ? '/dashboard' : '/mi-apto', { replace: true });
            return;
          }
          // On non-ok, retry before giving up
          attempts++;
          if (attempts < maxAttempts && !cancelled) await new Promise(r => setTimeout(r, 1500));
        } catch {
          attempts++;
          if (attempts < maxAttempts && !cancelled) await new Promise(r => setTimeout(r, 1500));
        }
      }
      // If server could not confirm in time, let user proceed or re-enter credentials safely
      if (!cancelled) {
        if (existing?.token && existing?.role) {
          navigate(existing.role === 'admin' ? '/dashboard' : '/mi-apto', { replace: true });
        } else {
          setCheckingStoredSession(false);
        }
      }
    }
    verifySession();
    return () => { cancelled = true; };
  }, [navigate]);

  function switchTab(newTab) {
    setTab(newTab);
    setRecovering(false);
    setError('');
    setShowPassword(false);
    if (newTab === 'admin') {
      setUsername('admin');
      setPassword('');
    } else {
      setUsername('');
      setPassword('');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = tab === 'admin'
        ? await loginAdmin(username.trim(), password.trim())
        : await loginTenant(username.trim(), password.trim());
      if (result.ok) {
        try {
          if (result.role === 'admin') await refreshAllFromServer();
          startCloudPolling(15000);
          startDataVersionPolling(3000);
        } catch { /* sync is best-effort */ }
        navigate(result.role === 'admin' ? '/dashboard' : '/mi-apto', { replace: true });
      } else {
        setError(result.error || 'Error al iniciar sesión');
      }
    } catch {
      setError('Error de conexión con el servidor. Intenta de nuevo.');
    }
    setLoading(false);
  }

  async function handleRecovery(e) {
    e.preventDefault();
    setError('');
    setRecoveryMessage('');
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(getBase() + '/admin/recover-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryCode, newPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo recuperar la contraseña.');
      setRecoveryMessage(result.message || 'Contraseña actualizada.');
      setRecovering(false);
      setRecoveryCode('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (recoveryError) {
      setError(recoveryError.message || 'No se pudo recuperar la contraseña.');
    }
    setLoading(false);
  }

  if (checkingStoredSession) {
    return (
      <div className="min-h-screen bg-[#090d16] flex items-center justify-center text-sm text-slate-400 gap-3">
        <div className="w-5 h-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
        <span>Verificando sesión en Laujim…</span>
      </div>
    );
  }

  return (
    <div className="login-scene min-h-screen bg-[#090d16] text-[#e2e8f0] flex flex-col justify-between antialiased relative overflow-x-hidden selection:bg-amber-500/30 selection:text-amber-200">
      
      {/* Luces ambientales de fondo */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-blue-600/15 via-amber-500/10 to-transparent blur-3xl pointer-events-none -z-10 animate-pulse-glow" />
      <div className="fixed bottom-0 right-0 w-[450px] h-[350px] bg-indigo-900/20 blur-3xl pointer-events-none -z-10" />

      {/* Header sutil de marca */}
      <header className="w-full max-w-5xl mx-auto px-6 pt-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/20 text-sm tracking-wider">
            L
          </div>
          <div>
            <span className="font-bold tracking-tight text-white text-base">LAUJIM</span>
            <span className="text-[10px] text-amber-400/90 font-medium block -mt-0.5 tracking-wider uppercase">Inmobiliaria & Hogar</span>
          </div>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-1.5 bg-white/5 border border-white/10 px-3 py-1 rounded-full backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Sistema Seguro
        </div>
      </header>

      {/* Contenido Central */}
      <main className="w-full max-w-md mx-auto px-4 py-6 flex-1 flex flex-col justify-center relative z-10 login-content">
        
        {/* Ilustración de Casa Cálida y Llave Flotante (Un nuevo comienzo) */}
        <div className="text-center mb-6 relative login-enter login-enter-1">
          <div className="relative inline-flex items-center justify-center mb-3">
            <div className="absolute -top-3 left-4 w-1.5 h-1.5 rounded-full bg-amber-400 particle-1" />
            <div className="absolute -top-5 right-6 w-2 h-2 rounded-full bg-amber-300 particle-2" />
            <div className="absolute -bottom-1 left-2 w-1.5 h-1.5 rounded-full bg-yellow-200 particle-3" />

            <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-b from-[#192238] to-[#0f172a] p-3.5 border border-white/10 shadow-2xl shadow-amber-500/10 flex items-center justify-center">
              <svg className="w-full h-full text-slate-300" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M32 8L6 30H14V54H50V30H58L32 8Z" fill="#1e293b" stroke="#94a3b8" strokeWidth="2.5" strokeLinejoin="round" />
                <rect x="25" y="22" width="14" height="14" rx="2" className="animate-window-light" />
                <path d="M32 22V36M25 29H39" stroke="#92400e" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M26 54V40C26 38.8954 26.8954 38 28 38H36C37.1046 38 38 38.8954 38 40V54" fill="#0f172a" stroke="#cbd5e1" strokeWidth="2" />
                <circle cx="29" cy="46" r="1.5" fill="#f59e0b" />
              </svg>

              {/* Llave de nuevo comienzo */}
              <div className="absolute -bottom-2.5 -right-2.5 w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 p-2 shadow-lg shadow-amber-500/40 border border-amber-300/40 flex items-center justify-center animate-float-key">
                <svg className="w-6 h-6 text-slate-950 fill-current" viewBox="0 0 24 24">
                  <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
                </svg>
              </div>
            </div>
          </div>

          <h1 className="text-3xl font-extrabold text-white tracking-tight">Laujim</h1>
          <p className="text-sm font-medium text-amber-400/95 mt-1">Donde las familias comienzan su historia</p>
          <p className="text-xs text-slate-400 mt-0.5">Bienvenido a tu nuevo hogar · Portal de Gestión</p>
        </div>

        {/* Tarjeta de Acceso */}
        <div className="bg-[#111827]/85 backdrop-blur-xl border border-slate-700/60 rounded-3xl p-6 shadow-2xl shadow-black/60 relative overflow-hidden login-enter login-enter-2">
          
          {/* Pestañas: Administrador vs Residente (Sin selector PC/Móvil) */}
          <div className="flex rounded-2xl bg-[#1e293b]/70 p-1 mb-6 border border-slate-700/50">
            <button
              type="button"
              onClick={() => switchTab('admin')}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
                tab === 'admin'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Administrador</span>
            </button>

            <button
              type="button"
              onClick={() => switchTab('tenant')}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
                tab === 'tenant'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Home className="w-4 h-4" />
              <span>Inquilino / Residente</span>
            </button>
          </div>

          <form onSubmit={recovering ? handleRecovery : handleSubmit} className="space-y-4">
            {recovering ? (
              <>
                <div>
                  <label htmlFor="admin-recovery-code" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Código de recuperación maestro</label>
                  <input id="admin-recovery-code" type="password" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} autoComplete="one-time-code" className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
                </div>
                <div>
                  <label htmlFor="admin-recovery-password" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Nueva contraseña</label>
                  <input id="admin-recovery-password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={10} autoComplete="new-password" className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
                </div>
                <div>
                  <label htmlFor="admin-recovery-confirm" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Confirmar contraseña</label>
                  <input id="admin-recovery-confirm" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={10} autoComplete="new-password" className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
                </div>
              </>
            ) : tab === 'admin' ? (
              <>
                <div>
                  <label htmlFor="login-admin-username" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                    <span>Usuario</span>
                    <span className="text-[11px] font-normal normal-case text-slate-400">Acceso del sistema</span>
                  </label>
                  <div className="relative flex items-center">
                    <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      id="login-admin-username"
                      name="username"
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="admin"
                      autoComplete="username"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-admin-password" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                    <span>Contraseña</span>
                    <span className="text-[11px] font-normal normal-case text-slate-400">Credencial secreta</span>
                  </label>
                  <div className="relative flex items-center">
                    <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="login-admin-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(prev => !prev)}
                      className="absolute right-3 p-1 text-slate-400 hover:text-white transition"
                      title={showPassword ? 'Ocultar' : 'Mostrar'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="login-tenant-apartment" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                    <span>Apartamento</span>
                    <span className="text-[11px] font-normal normal-case text-amber-400/90">Ej: 101, 202, 303</span>
                  </label>
                  <div className="relative flex items-center">
                    <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                      <Home className="w-4 h-4" />
                    </div>
                    <input
                      id="login-tenant-apartment"
                      name="apartment"
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="Ej: 101"
                      autoComplete="off"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-tenant-document" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                    <span>Número de Cédula</span>
                    <span className="text-[11px] font-normal normal-case text-slate-400">Sin puntos ni comas</span>
                  </label>
                  <div className="relative flex items-center">
                    <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="login-tenant-document"
                      name="documentId"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Número de documento"
                      autoComplete="off"
                      className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(prev => !prev)}
                      className="absolute right-3 p-1 text-slate-400 hover:text-white transition"
                      title={showPassword ? 'Ocultar' : 'Mostrar'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <KeyRound className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-3 px-4 rounded-xl text-sm font-bold transition-all duration-200 shadow-lg flex items-center justify-center gap-2 mt-2 active:scale-[0.98] disabled:opacity-50 ${
                tab === 'admin'
                  ? 'text-white bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-blue-500/25'
                  : 'text-slate-950 bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 hover:from-amber-300 hover:to-yellow-300 shadow-amber-500/25'
              }`}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  <span>{recovering ? 'Actualizando...' : 'Verificando...'}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span>{recovering ? 'Guardar nueva contraseña' : tab === 'admin' ? 'Ingresar como Administrador' : 'Entrar a Mi Apartamento'}</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              )}
            </button>

            {tab === 'admin' && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => { setRecovering(value => !value); setError(''); setRecoveryMessage(''); }}
                  className="text-xs text-blue-400 hover:text-blue-300 transition font-medium underline-offset-4 hover:underline"
                >
                  {recovering ? 'Volver al inicio de sesión' : '¿Olvidaste tu contraseña de administrador?'}
                </button>
              </div>
            )}
          </form>
        </div>

        {recoveryMessage && (
          <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-xs text-emerald-300">
            {recoveryMessage}
          </p>
        )}

        <div className="text-center mt-6 login-enter login-enter-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 shadow-sm">
            <Home className="w-3.5 h-3.5 text-amber-400" />
            <span>{tab === 'admin' ? 'Acceso administrativo al tablero operativo de Laujim' : 'Los residentes ingresan con su Apartamento y Cédula'}</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-5xl mx-auto px-6 py-4 text-center text-[11px] text-slate-600 z-10">
        © 2026 Edificio Laujim · Sistema Inmobiliario Inteligente
      </footer>
    </div>
  );
}
