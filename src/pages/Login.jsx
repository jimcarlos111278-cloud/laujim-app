import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginAdmin, loginTenant, getAuth } from '../utils/auth';
import { getViewMode, setViewMode } from '../utils/viewMode';
import { Building2, Monitor, Smartphone, KeyRound, User, ShieldCheck } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('admin');
  const [vm, setVm] = useState(getViewMode());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const existing = getAuth();
  if (existing) {
    if (existing.role === 'admin') navigate('/dashboard', { replace: true });
    else navigate('/mi-apto', { replace: true });
  }

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
        navigate(result.role === 'admin' ? '/dashboard' : '/mi-apto', { replace: true });
      } else {
        setError(result.error || 'Error al iniciar sesión');
      }
    } catch (e) {
      setError('Error de conexión');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Gestión de Apartamentos</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Inicia sesión para continuar</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-6 animate-fadeIn">
          <button onClick={() => changeViewMode('horizontal')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${vm === 'horizontal' ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 hover:border-blue-300'}`}>
            <Monitor className="w-4 h-4" /> PC
          </button>
          <span className="text-gray-300 dark:text-gray-600 text-xs">MODO</span>
          <button onClick={() => changeViewMode('vertical')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${vm === 'vertical' ? 'bg-emerald-600 text-white shadow-lg scale-105' : 'bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 hover:border-emerald-300'}`}>
            <Smartphone className="w-4 h-4" /> Móvil
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Usuario</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Apartamento</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Ej: 102, 201, 301" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Código de 4 dígitos" maxLength={4} className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none" required />
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

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
          Los inquilinos pueden ingresar con el número de apartamento y su código de 4 dígitos
        </p>
      </div>
    </div>
  );
}
