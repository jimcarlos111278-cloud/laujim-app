import { useState, useEffect } from 'react';
import { Search, ExternalLink, Building2, Hash, Edit2 } from 'lucide-react';
import { api } from '../api';

const PREDIAL_URL = 'https://orion.barranquilla.gov.co:8787/Predial/BuscarPredioLiq.do?txtDato=REFCAT&txtTipoBusqueda=PorReferencia';

function getPredialUrl(refCatastral) {
  return PREDIAL_URL.replace('REFCAT', encodeURIComponent(refCatastral.replace(/\s/g, '')));
}

export default function Predial() {
  const [apartments, setApartments] = useState([]);
  const [search, setSearch] = useState('');
  const [editingRef, setEditingRef] = useState(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const a = await api.apartments.toArray();
    setApartments(a);
  }

  async function saveRefCatastral(aptId) {
    await api.apartments.update(aptId, { refCatastral: editValue });
    setApartments(prev => prev.map(a => a.id === aptId ? { ...a, refCatastral: editValue } : a));
    setEditingRef(null);
  }

  function startEdit(apt) {
    setEditingRef(apt.id);
    setEditValue(apt.refCatastral || '');
  }

  const filtered = apartments.filter(a => {
    if (!search) return true;
    const s = search.toLowerCase();
    return a.name.toLowerCase().includes(s) || (a.refCatastral || '').includes(s);
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

      <div className="grid gap-3">
        {filtered.map(apt => {
          const ref = apt.refCatastral || '';
          const url = ref ? getPredialUrl(ref) : '';
          const isEditing = editingRef === apt.id;
          return (
            <div key={apt.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-750 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-c-500" />
                  <h2 className="font-bold text-gray-900 dark:text-white">Apartamento {apt.name}</h2>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${apt.status === 'occupied' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                  {apt.status === 'occupied' ? 'Arrendado' : 'Disponible'}
                </span>
              </div>
              <div className="p-4">
                {isEditing ? (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Ref. Catastral</label>
                    <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)}
                      placeholder="Ej: 0105000004210006901010001"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono focus:ring-2 focus:ring-c-500 outline-none" />
                    <div className="flex gap-2">
                      <button onClick={() => saveRefCatastral(apt.id)}
                        className="px-4 py-2 bg-c-500 text-white text-sm font-medium rounded-lg hover:bg-c-600 transition-colors">
                        Guardar
                      </button>
                      <button onClick={() => setEditingRef(null)}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {ref ? (
                        <p className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate">{ref}</p>
                      ) : (
                        <p className="text-sm text-gray-400 dark:text-gray-500">Sin referencia catastral</p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Ref. Catastral</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => startEdit(apt)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">
                        <Hash className="w-3 h-3" /> Ref.
                      </button>
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-c-500 hover:bg-c-600 rounded-lg transition-colors shadow-sm">
                          <ExternalLink className="w-4 h-4" /> Pagar Predial
                        </a>
                      )}
                    </div>
                  </div>
                )}
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