import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setAuth } from '../utils/auth';
import { refreshAllFromServer, startCloudPolling, startDataVersionPolling } from '../api';

const ERROR_TEXT = {
  github_no_configurado: 'Login con GitHub no configurado en el servidor.',
  sesion_oauth_expirada: 'La sesión de GitHub expiró. Intenta de nuevo.',
  base_de_datos_iniciando: 'La base de datos está iniciando. Intenta de nuevo en unos segundos.',
  token_github_invalido: 'GitHub no devolvió un token válido.',
  cuenta_no_autorizada: 'Esta cuenta de GitHub no está autorizada.',
  error_conexion_github: 'No se pudo conectar con GitHub.',
};

export default function GitHubAuth() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    const token = params.get('token');
    try { window.history.replaceState({}, '', '/github-auth'); } catch {}
    if (err) {
      setError(ERROR_TEXT[err] || 'Error al entrar con GitHub.');
      return;
    }
    if (!token) {
      setError('Respuesta de GitHub inválida.');
      return;
    }
    setAuth({
      role: params.get('role') || 'admin',
      name: params.get('name') || 'GitHub',
      token,
      expiresAt: params.get('expiresAt') || null,
    });
    refreshAllFromServer()
      .catch(() => {})
      .finally(() => {
        try { startCloudPolling(15000); } catch {}
        try { startDataVersionPolling(3000); } catch {}
        navigate('/dashboard', { replace: true });
      });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#090d16] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-700/60 bg-[#111827]/85 p-6 text-center">
        {error ? (
          <>
            <p className="text-sm font-bold text-white">No se pudo entrar con GitHub</p>
            <p className="mt-2 text-xs text-rose-300">{error}</p>
            <Link to="/login" className="mt-4 inline-block rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white">Volver al login</Link>
          </>
        ) : (
          <div className="flex items-center justify-center gap-3 text-sm text-slate-400">
            <span className="w-5 h-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            <span>Verificando con GitHub…</span>
          </div>
        )}
      </div>
    </div>
  );
}
