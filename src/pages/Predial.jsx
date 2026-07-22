import { useState, useEffect } from 'react';
import { Search, ExternalLink, Building2 } from 'lucide-react';
import { api } from '../api';

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

export default function Predial() {
  const [apartments, setApartments] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const a = await api.apartments.toArray();
    setApartments(a);
  }

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
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{apartments.length} apartamentos</p>
        </div>
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar apto o ref. catastral..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-c-500 outline-none" />
        </div>
      </div>

      <div className="grid gap-2">
        {filtered.map(apt => {
          const ref = lookupRef(apt.name);
          const url = ref ? getPredialUrl(ref) : '';
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
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${apt.status === 'occupied' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {apt.status === 'occupied' ? 'Arrendado' : 'Disponible'}
                  </span>
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-c-500 hover:bg-c-600 rounded-lg transition-colors shadow-sm">
                      <ExternalLink className="w-4 h-4" /> Consulta
                    </a>
                  )}
                </div>
              </div>
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
    </div>
  );
}