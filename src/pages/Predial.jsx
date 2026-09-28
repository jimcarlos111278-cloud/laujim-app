import { useState, useEffect } from 'react';
import { Search, ExternalLink, Building2, RefreshCw, BadgeCheck, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { getBase } from '../utils/config';
import { getAuth } from '../utils/auth';

const PREDIAL_URL = 'https://orion.barranquilla.gov.co:8787/Predial/BuscarPredioLiq.do?txtDato=REFCAT&txtTipoBusqueda=PorReferencia';

const REF_MAP = {
  '101': '0105000004210006901010001',
  '102': '0105000004210006901010002',
  '201': '0105000004210006901020001',
  '202': '0105000004210006901020002',
  '203': '0105000004210006901020003',
  '301': '0105000004210006901030001',
  '302': '0105000004210006901030002',
  '303': '0105000004210006901030003',
  '401': '0105000004210006901040001',
  '402': '0105000004210006901040002',
  '403': '0105000004210006901040003',
  '501': '0105000004210006901050001',
};

function lookupRef(name) {
  const n = (name || '').replace(/[^0-9]/g, '');
  return REF_MAP[n] || '';
}

function getPredialUrl(ref) {
  return PREDIAL_URL.replace('REFCAT', encodeURIComponent(ref.replace(/\s/g, '')));
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return '—'; }
}

function authHeaders() {
  const auth = getAuth() || {};
  return { 'x-auth-token': auth.token || '', 'Content-Type': 'application/json' };
}

const DATO_LABELS = [
  ['referencia', 'Ref. Catastral'], ['direccion', 'Dirección'],
  ['matricula', 'Matrícula'], ['estrato', 'Estrato'],
  ['terreno', 'Área Terreno'], ['construida', 'Área Construida'],
  ['destino', 'Destino'], ['postal', 'Cód. Postal'],
];

export default function Predial() {
  const [apartments, setApartments] = useState([]);
  const [estado, setEstado] = useState(null);
  const [granTotal, setGranTotal] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const a = await api.apartments.toArray().catch(() => []);
    setApartments(a);
    try {
      const res = await fetch(getBase() + '/predial/status', { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.ok) {
          setEstado(data.apartamentos || []);
          setGranTotal(data.granTotal || null);
          setUpdatedAt(data.updatedAt || null);
        }
      }
    } catch { /* sin datos del servidor: se muestra la lista base */ }
    finally { setLoading(false); }
  }

  async function refresh() {
    setRefreshing(true);
    setMsg('');
    try {
      const res = await fetch(getBase() + '/predial/refresh', {
        method: 'POST', headers: authHeaders(), signal: AbortSignal.timeout(120000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error del servidor');
      setMsg(`Consulta completa: ${data.meta?.consultados ?? '?'} apartamentos.`);
      await load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  const porApto = {};
  for (const e of estado || []) porApto[String(e.apt)] = e;

  const filtered = apartments.filter(a => {
    if (!search) return true;
    const s = search.toLowerCase();
    return a.name.toLowerCase().includes(s) || lookupRef(a.name).includes(s);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-6 h-6 text-c-500" /> Impuesto Predial
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
            {apartments.length} apartamentos · consulta automática cada 24 h
            {updatedAt ? ` · act. ${fmtDate(updatedAt)}` : ' · sin datos aún'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Buscar apto o ref. catastral..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-c-500 outline-none" />
          </div>
          <button onClick={refresh} disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-c-500 hover:bg-c-600 rounded-lg transition-colors shadow-sm disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Consultando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {msg && <p className="text-xs rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300">{msg}</p>}

      {granTotal && (
        <section className="rounded-2xl bg-white dark:bg-gray-800 p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-white text-sm">Deuda total del edificio</h2>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 p-3">
              <p className="text-[10px] uppercase text-rose-500 font-bold">Total</p>
              <p className="text-lg font-black text-rose-600 dark:text-rose-400">{fmtMoney(granTotal.total)}</p>
            </div>
            <div className="rounded-xl bg-slate-100 dark:bg-slate-700/40 p-3">
              <p className="text-[10px] uppercase text-slate-500 font-bold">Capital</p>
              <p className="text-lg font-black text-slate-700 dark:text-slate-200">{fmtMoney(granTotal.capital)}</p>
            </div>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3">
              <p className="text-[10px] uppercase text-amber-600 font-bold">Intereses</p>
              <p className="text-lg font-black text-amber-600 dark:text-amber-400">{fmtMoney(granTotal.intereses)}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 p-3">
              <p className="text-[10px] uppercase text-emerald-600 font-bold">Descuentos</p>
              <p className="text-lg font-black text-emerald-600 dark:text-emerald-400">{fmtMoney(granTotal.descuento)}</p>
            </div>
            <div className="rounded-xl bg-slate-100 dark:bg-slate-700/40 p-3">
              <p className="text-[10px] uppercase text-slate-500 font-bold">Aptos con deuda</p>
              <p className="text-lg font-black text-slate-700 dark:text-slate-200">{granTotal.deudas ?? 0}/{granTotal.apartamentos ?? 0}</p>
            </div>
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-xs text-slate-400 py-8 text-center">Cargando predial…</p>
      ) : (
        <div className="grid gap-2">
          {filtered.map(apt => {
            const ref = lookupRef(apt.name);
            const url = ref ? getPredialUrl(ref) : '';
            const info = porApto[String(apt.name)];
            const tiene = info && !info.error && (info.vigencias?.length > 0 || info.totales?.total > 0);
            return (
              <div key={apt.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-4 h-4 text-c-500 shrink-0" />
                    <div className="min-w-0">
                      <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Apartamento {apt.name}</h2>
                      {ref && <p className="text-xs font-mono text-gray-400 dark:text-gray-500 truncate mt-0.5">{ref}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {info && !info.error && info.totales?.total > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                        <AlertTriangle className="w-3 h-3" /> {fmtMoney(info.totales.total)}
                      </span>
                    ) : info && !info.error ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        <BadgeCheck className="w-3 h-3" /> Paz y salvo
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Sin datos</span>
                    )}
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-c-500 hover:bg-c-600 rounded-lg transition-colors shadow-sm">
                        <ExternalLink className="w-4 h-4" /> Consulta
                      </a>
                    )}
                  </div>
                </div>
                {tiene && (
                  <div className="px-4 pb-3 text-xs text-gray-600 dark:text-gray-300">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 dark:bg-slate-700/30 p-3">
                      {DATO_LABELS.map(([k, label]) => (
                        <p key={k} className="truncate"><span className="text-gray-400">{label}:</span> <strong>{info.datos?.[k] || '—'}</strong></p>
                      ))}
                    </div>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-gray-200 dark:border-gray-700">
                            <th className="py-1 pr-2">Vigencia</th>
                            <th className="py-1 pr-2 text-right">Capital</th>
                            <th className="py-1 pr-2 text-right">Intereses</th>
                            <th className="py-1 pr-2 text-right">Descuento</th>
                            <th className="py-1 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {info.vigencias.map(v => (
                            <tr key={v.vigencia} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="py-1 pr-2 font-bold">{v.vigencia}</td>
                              <td className="py-1 pr-2 text-right">{fmtMoney(v.capital)}</td>
                              <td className="py-1 pr-2 text-right">{fmtMoney(v.intereses)}</td>
                              <td className="py-1 pr-2 text-right text-emerald-600">{fmtMoney(v.descuento)}</td>
                              <td className="py-1 text-right font-bold">{fmtMoney(v.total)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td className="py-1 pr-2 font-bold">Subtotal</td>
                            <td className="py-1 pr-2 text-right font-bold">{fmtMoney(info.totales.capital)}</td>
                            <td className="py-1 pr-2 text-right font-bold">{fmtMoney(info.totales.intereses)}</td>
                            <td className="py-1 pr-2 text-right font-bold text-emerald-600">{fmtMoney(info.totales.descuento)}</td>
                            <td className="py-1 text-right font-black">{fmtMoney(info.totales.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {info?.error && (
                  <p className="px-4 pb-3 text-[11px] text-amber-600">No se pudo consultar: {info.error}</p>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>{search ? 'No se encontraron apartamentos' : 'No hay apartamentos registrados'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
