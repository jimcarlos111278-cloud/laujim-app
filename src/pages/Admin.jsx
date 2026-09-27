import { useEffect, useMemo, useState } from 'react';
import { getBase } from '../utils/config';
import { ShieldCheck, LogOut, Users, Activity, CalendarDays, RefreshCw, Lock, Network, Database, Download } from 'lucide-react';

const TOKEN_KEY = 'laujim_admin_token';

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso || '—'; }
}

function dayKey(iso) {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch { return '—'; }
}

function fmtBytes(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Admin() {
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [graph, setGraph] = useState(null);
  const [graphMsg, setGraphMsg] = useState('');
  const [graphBusy, setGraphBusy] = useState(false);
  const [secrets, setSecrets] = useState(null);
  const [secretsMsg, setSecretsMsg] = useState('');
  const [secretsBusy, setSecretsBusy] = useState(false);

  async function authed(path) {
    const res = await fetch(getBase() + path, { headers: { 'x-auth-token': token }, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) {
      sessionStorage.removeItem(TOKEN_KEY);
      setToken('');
      throw new Error('Sesión de admin vencida. Ingresa de nuevo.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error del servidor');
    return data;
  }

  async function loadData(tk) {
    const headers = { 'x-auth-token': tk };
    const [sessRes, auditRes] = await Promise.all([
      fetch(getBase() + '/admin/sessions', { headers, signal: AbortSignal.timeout(10000) }),
      fetch(getBase() + '/audit/logs?limit=500', { headers, signal: AbortSignal.timeout(10000) }),
    ]);
    if (sessRes.status === 401 || sessRes.status === 403 || auditRes.status === 401 || auditRes.status === 403) {
      sessionStorage.removeItem(TOKEN_KEY);
      setToken('');
      throw new Error('Sesión de admin vencida. Ingresa de nuevo.');
    }
    if (!sessRes.ok) throw new Error('No se pudo cargar sesiones activas.');
    if (!auditRes.ok) throw new Error('No se pudo cargar auditoría.');
    const sess = await sessRes.json().catch(() => ({}));
    const audit = await auditRes.json().catch(() => []);
    if (sess?.sessions) setSessions(sess.sessions);
    else setSessions([]);
    if (Array.isArray(audit)) setLogs(audit);
    else setLogs([]);
    try {
      const gRes = await fetch(getBase() + '/admin/graph/status', { headers, signal: AbortSignal.timeout(15000) });
      if (gRes.ok) setGraph(await gRes.json().catch(() => null));
    } catch { /* el panel del grafo es opcional */ }
    try {
      const sRes = await fetch(getBase() + '/admin/secrets/status', { headers, signal: AbortSignal.timeout(15000) });
      if (sRes.ok) setSecrets(await sRes.json().catch(() => null));
    } catch { /* el panel de secretos es opcional */ }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(getBase() + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: password.trim() }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authenticated || data.role !== 'admin' || !data.token) {
        throw new Error(data.error || 'Contraseña inválida');
      }
      sessionStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setPassword('');
      await loadData(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    loadData(token).catch(err => setError(err.message));
    const t = setInterval(() => loadData(token).catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [token]);

  const stats = useMemo(() => {
    const isLogin = e => String(e || '').startsWith('LOGIN');
    const isLogout = e => String(e || '').startsWith('LOGOUT');
    const logins = logs.filter(l => isLogin(l.event));
    const logouts = logs.filter(l => isLogout(l.event));
    const byUser = {};
    for (const l of logs) {
      const u = l.user || 'anon';
      byUser[u] = byUser[u] || { logins: 0, events: 0, days: new Set(), last: null };
      byUser[u].events += 1;
      if (isLogin(l.event)) byUser[u].logins += 1;
      if (l.timestamp) {
        byUser[u].days.add(dayKey(l.timestamp));
        if (!byUser[u].last || l.timestamp > byUser[u].last) byUser[u].last = l.timestamp;
      }
    }
    const rows = Object.entries(byUser).map(([user, v]) => ({ user, logins: v.logins, events: v.events, days: v.days.size, last: v.last }));
    rows.sort((a, b) => (b.events || 0) - (a.events || 0));
    return { logins: logins.length, logouts: logouts.length, rows };
  }, [logs]);

  function handleLogout() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    setToken('');
    setSessions([]);
    setLogs([]);
    setGraph(null);
  }

  async function graphAction(action) {
    setGraphBusy(true);
    setGraphMsg('');
    try {
      const res = await fetch(getBase() + '/admin/graph/' + action, {
        method: 'POST',
        headers: { 'x-auth-token': token },
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error del servidor');
      setGraphMsg(data.message || 'Listo.');
      await loadData(token);
    } catch (err) {
      setGraphMsg(err.message);
    } finally {
      setGraphBusy(false);
    }
  }

  async function downloadGraph() {
    setGraphMsg('');
    try {
      const res = await fetch(getBase() + '/admin/graph/file?name=graph', { headers: { 'x-auth-token': token } });
      if (!res.ok) throw new Error('No se pudo descargar la copia.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'graph.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setGraphMsg(err.message);
    }
  }

  async function backupSecrets() {
    setSecretsBusy(true);
    setSecretsMsg('');
    try {
      const res = await fetch(getBase() + '/admin/secrets/backup', {
        method: 'POST',
        headers: { 'x-auth-token': token },
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error del servidor');
      setSecretsMsg(data.message || 'Listo.');
      await loadData(token);
    } catch (err) {
      setSecretsMsg(err.message);
    } finally {
      setSecretsBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600/20 text-blue-400"><Lock className="h-6 w-6" /></div>
          <h1 className="text-center text-lg font-bold text-white">Acceso administrador</h1>
          <p className="mt-1 text-center text-xs text-slate-400">Solo contraseña de admin. Monitoreo de inquilinos.</p>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Contraseña de admin"
            autoComplete="current-password"
            className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
          />
          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
          <button disabled={loading || !password} className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Verificando…' : 'Entrar'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      <header className="bg-slate-950 px-4 py-4 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-400" /><h1 className="font-bold">Panel admin · Inquilinos</h1></div>
          <div className="flex gap-2">
            <button onClick={() => loadData(token).catch(e => setError(e.message))} className="rounded-lg bg-white/10 p-2" title="Actualizar"><RefreshCw className="h-4 w-4" /></button>
            <button onClick={handleLogout} className="rounded-lg bg-white/10 p-2" title="Salir"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-4 pt-4">
        {error && <p className="rounded-xl bg-rose-100 px-4 py-2 text-xs text-rose-700">{error}</p>}
        <section className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm"><p className="flex items-center gap-1 text-xs text-slate-500"><Users className="h-3.5 w-3.5" /> En línea</p><p className="mt-1 text-2xl font-bold">{sessions.length}</p></div>
          <div className="rounded-2xl bg-white p-4 shadow-sm"><p className="flex items-center gap-1 text-xs text-slate-500"><Activity className="h-3.5 w-3.5" /> Entradas</p><p className="mt-1 text-2xl font-bold">{stats.logins}</p></div>
          <div className="rounded-2xl bg-white p-4 shadow-sm"><p className="flex items-center gap-1 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" /> Salidas</p><p className="mt-1 text-2xl font-bold">{stats.logouts}</p></div>
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-900">Conectados ahora ({sessions.length})</h2>
          <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs">
            <thead><tr className="text-slate-400"><th className="py-1 pr-2">Usuario</th><th className="py-1 pr-2">Rol</th><th className="py-1 pr-2">Apto</th><th className="py-1 pr-2">Desde</th><th className="py-1">Expira</th></tr></thead>
            <tbody>{sessions.map((s, i) => (
              <tr key={i} className="border-t border-slate-100"><td className="py-1.5 pr-2 font-semibold">{s.name || '—'}</td><td className="py-1.5 pr-2">{s.role || '—'}</td><td className="py-1.5 pr-2">{s.apartmentId ?? '—'}</td><td className="py-1.5 pr-2">{fmtDate(s.createdAt)}</td><td className="py-1.5">{fmtDate(s.expiresAt)}</td></tr>
            ))}{sessions.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-slate-400">Nadie conectado</td></tr>}</tbody>
          </table></div>
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 font-bold text-slate-900"><Network className="h-4 w-4" /> Grafo de conocimiento</h2>
          {!graph ? (
            <p className="mt-2 text-xs text-slate-400">Cargando estado del grafo…</p>
          ) : (
            <div className="mt-2 space-y-2 text-xs text-slate-600">
              <p>📀 <b>VM (disco):</b> {graph.disk?.nodes ?? '—'} nodos · {graph.disk?.links ?? '—'} enlaces · {fmtBytes(graph.disk?.graph?.size)} · act. {fmtDate(graph.disk?.graph?.mtime)}</p>
              <p>🐙 <b>GitHub:</b> {graph.github?.tracked ? `versionado · último commit ${fmtDate(graph.github?.lastCommit)}` : 'no disponible en este servidor'}</p>
              <p>🗄️ <b>Aiven:</b> {!graph.aiven?.configured ? 'no configurado' : graph.aiven?.exists ? `${graph.aiven?.nodeCount ?? '—'} nodos · act. ${fmtDate(graph.aiven?.updatedAt)} (${graph.aiven?.source || '—'})` : 'sin copia (usa “Guardar copia en Aiven”)'}</p>
              {graph.update?.running && <p className="text-amber-600">⏳ Actualización en curso en la VM…</p>}
              {graph.update?.finishedAt && !graph.update?.running && <p className="text-slate-400">Última actualización: {fmtDate(graph.update.finishedAt)} (código {String(graph.update.exitCode)})</p>}
              {graphMsg && <p className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{graphMsg}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <button disabled={graphBusy || graph.update?.running} onClick={() => graphAction('update')} className="rounded-xl bg-indigo-600 px-3 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Actualizar en VM</button>
                <button disabled={graphBusy} onClick={() => graphAction('sync-to-aiven')} className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Database className="h-3.5 w-3.5" /> Guardar copia en Aiven</button>
                <button disabled={graphBusy} onClick={downloadGraph} className="flex items-center gap-1 rounded-xl bg-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Descargar copia</button>
              </div>
            </div>
          )}
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 font-bold text-slate-900"><Database className="h-4 w-4" /> Respaldos: secretos y medios</h2>
          {!secrets ? (
            <p className="mt-2 text-xs text-slate-400">Cargando estado de respaldos…</p>
          ) : (
            <div className="mt-2 space-y-2 text-xs text-slate-600">
              <p>🔑 <b>Secretos en esta VM:</b> {Object.values(secrets.env || {}).filter(Boolean).length}/{Object.keys(secrets.env || {}).length} presentes</p>
              <p>🗄️ <b>Copia en Aiven:</b> {!secrets.aiven?.configured ? 'no configurado' : secrets.aiven?.exists ? `${secrets.aiven?.names?.length ?? '—'} secretos · act. ${fmtDate(secrets.aiven?.updatedAt)}` : 'sin copia (usa “Respaldar ahora”)'}</p>
              <p>🖼️ <b>Medios (fotos/backups):</b> se respaldan a R2 desde la VM con <code>npm run backup:media</code></p>
              {secretsMsg && <p className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{secretsMsg}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <button disabled={secretsBusy} onClick={backupSecrets} className="rounded-xl bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Respaldar secretos en Aiven</button>
              </div>
            </div>
          )}
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-900">Uso por usuario (últimos 500 eventos)</h2>
          <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs">
            <thead><tr className="text-slate-400"><th className="py-1 pr-2">Usuario</th><th className="py-1 pr-2">Entradas</th><th className="py-1 pr-2">Eventos</th><th className="py-1 pr-2">Días activos</th><th className="py-1">Última actividad</th></tr></thead>
            <tbody>{stats.rows.map(r => (
              <tr key={r.user} className="border-t border-slate-100"><td className="py-1.5 pr-2 font-semibold">{r.user}</td><td className="py-1.5 pr-2">{r.logins}</td><td className="py-1.5 pr-2">{r.events}</td><td className="py-1.5 pr-2">{r.days}</td><td className="py-1.5">{fmtDate(r.last)}</td></tr>
            ))}{stats.rows.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-slate-400">Sin actividad registrada</td></tr>}</tbody>
          </table></div>
        </section>
      </main>
    </div>
  );
}
