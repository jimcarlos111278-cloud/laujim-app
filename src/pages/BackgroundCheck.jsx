import { useState, useEffect } from 'react';
import { Search, Shield, ExternalLink, CheckCircle2, XCircle, AlertTriangle, Clock, User, Loader2 } from 'lucide-react';
import { api } from '../api';
import { getBase } from '../utils/config';
import Modal from '../components/Modal';

const POLICE_URL = 'https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml';

export default function BackgroundCheck() {
  const [tenants, setTenants] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const [t, a] = await Promise.all([api.tenants.toArray(), api.apartments.toArray()]);
    setTenants(t);
    setApartments(a);
  }

  async function handleAutoCheck(tenant) {
    if (!tenant.documentId || !tenant.documentId.trim()) {
      setSelected(tenant);
      setCheckResult({ status: 'error', message: 'El inquilino no tiene cédula registrada. Ve a Inquilinos para agregarla.' });
      return;
    }
    setSelected(tenant);
    setChecking(true);
    setCheckResult(null);
    try {
      const base = getBase();
      const res = await fetch(base + '/antecedentes/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': 'laujim laujim' },
        body: JSON.stringify({ document: tenant.documentId }),
      });
      const data = await res.json();
      setCheckResult(data);
      if (data.status === 'clean' || data.status === 'flagged') {
        const hasAntecedentes = data.status === 'flagged';
        const field = { antecedentes: hasAntecedentes, antecedentesDate: new Date().toISOString().split('T')[0] };
        await api.tenants.update(tenant.id, field);
        setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, ...field } : t));
      }
    } catch (e) {
      setCheckResult({ status: 'error', message: e.message });
    } finally {
      setChecking(false);
    }
  }

  async function handleManualSave(tenantId, hasAntecedentes) {
    const field = hasAntecedentes !== null ? { antecedentes: hasAntecedentes, antecedentesDate: new Date().toISOString().split('T')[0] } : { antecedentes: null, antecedentesDate: null };
    await api.tenants.update(tenantId, field);
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, ...field } : t));
    setSelected(null);
    setCheckResult(null);
  }

  function getAptName(tenant) {
    const apt = apartments.find(a => a.id === tenant.apartmentId);
    return apt ? apt.name : '—';
  }

  function getStatusBadge(tenant) {
    if (tenant.antecedentes === undefined || tenant.antecedentes === null) {
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full"><Clock className="w-3 h-3" /> Sin verificar</span>;
    }
    if (tenant.antecedentes === false) {
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full"><CheckCircle2 className="w-3 h-3" /> Sin antecedentes</span>;
    }
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full"><XCircle className="w-3 h-3" /> Con antecedentes</span>;
  }

  async function handleSaveResult(tenantId, hasAntecedentes) {
    const field = hasAntecedentes !== null ? { antecedentes: hasAntecedentes, antecedentesDate: new Date().toISOString().split('T')[0] } : { antecedentes: null, antecedentesDate: null };
    await api.tenants.update(tenantId, field);
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, ...field } : t));
    setSelected(null);
  }

  const filtered = tenants.filter(t => {
    if (!search) return true;
    const s = search.toLowerCase();
    return t.name?.toLowerCase().includes(s) || t.documentId?.includes(s) || t.phone?.includes(s);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-c-500" /> Verificar Antecedentes
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{tenants.length} inquilinos</p>
        </div>
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar inquilino o cédula..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-c-500 outline-none" />
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Inquilino</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Cédula</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Apto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Estado</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-c-50 text-c-600 flex items-center justify-center">
                        <User className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-gray-900 dark:text-white">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-gray-700 dark:text-gray-300">{t.documentId || <span className="text-red-400">Sin cédula</span>}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{getAptName(t)}</td>
                  <td className="px-4 py-3">{getStatusBadge(t)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleAutoCheck(t)} disabled={checking && selected?.id === t.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-c-600 bg-c-50 hover:bg-c-100 rounded-lg transition-colors disabled:opacity-50">
                      {checking && selected?.id === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                      Verificar
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No se encontraron inquilinos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={selected !== null} onClose={() => { if (!checking) { setSelected(null); setCheckResult(null); } }} title={selected ? `Antecedentes - ${selected.name}` : ''}>
        {selected && (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="w-10 h-10 rounded-full bg-c-50 text-c-600 flex items-center justify-center">
                <User className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{selected.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Cédula: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{selected.documentId || 'No registrada'}</span></p>
              </div>
            </div>

            {/* Checking state */}
            {checking && (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="w-8 h-8 text-c-500 animate-spin" />
                <p className="text-sm text-gray-500">Consultando en Policía Nacional...</p>
              </div>
            )}

            {/* Auto result: clean */}
            {!checking && checkResult?.status === 'clean' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <p className="font-medium text-emerald-800">Sin antecedentes</p>
                <p className="text-sm text-emerald-600 mt-1">NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES</p>
              </div>
            )}

            {/* Auto result: flagged */}
            {!checking && checkResult?.status === 'flagged' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                <XCircle className="w-10 h-10 text-red-500 mx-auto mb-2" />
                <p className="font-medium text-red-800">Con antecedentes</p>
                {checkResult.detail && <p className="text-sm text-red-600 mt-1">{checkResult.detail}</p>}
              </div>
            )}

            {/* Captcha bloqueó la consulta automática */}
            {!checking && checkResult?.status === 'captcha' && (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>El sitio web requiere resolver un captcha. Ábrelo manualmente y marca el resultado.</p>
                  </div>
                </div>
                <a href={POLICE_URL} target="_blank" rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-c-500 text-white text-sm font-medium rounded-lg hover:bg-c-600 transition-colors">
                  <ExternalLink className="w-4 h-4" /> Consultar en Policía
                </a>
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Resultado de la consulta:</p>
                  <div className="flex gap-3">
                    <button onClick={() => handleManualSave(selected.id, false)}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium text-sm rounded-lg border border-emerald-200 hover:border-emerald-300 transition-colors">
                      <CheckCircle2 className="w-5 h-5" /> Sin antecedentes
                    </button>
                    <button onClick={() => handleManualSave(selected.id, true)}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-red-50 hover:bg-red-100 text-red-700 font-medium text-sm rounded-lg border border-red-200 hover:border-red-300 transition-colors">
                      <XCircle className="w-5 h-5" /> Con antecedentes
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Error */}
            {!checking && checkResult?.status === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <p className="font-medium">Error al consultar</p>
                <p className="mt-1">{checkResult.message || 'Intenta de nuevo o usa el método manual.'}</p>
                <button onClick={() => handleAutoCheck(selected)}
                  className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors">
                  Reintentar
                </button>
              </div>
            )}

            {/* Previous check info */}
            {!checking && selected.antecedentes !== undefined && selected.antecedentes !== null && (
              <div className="flex items-center justify-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-500">Verificado el {selected.antecedentesDate || 'fecha desconocida'}</span>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}