import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Download, ArrowLeft, MessageCircle, Share2 } from 'lucide-react';
import { api } from '../api';
import { generateContractPDF } from '../utils/contractGenerator';
import { isCapacitor } from '../utils/config';

export default function ContractGenerator() {
  const { id } = useParams();
  const [apts, setApts] = useState([]);
  const [apt, setApt] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [form, setForm] = useState({
    propietario_nombre: 'Mercedes Gomez Rodriguez',
    propietario_cedula: '44.155.705',
    propietario_expedida: 'Soledad',
    cuenta: '912 022398 84',
    arrendatario_nombre: '',
    arrendatario_cedula: '',
    arrendatario_expedida: 'Soledad',
    apto: '',
    direccion: 'Carrera 10C no. 45B-37',
    canon: '',
    deposito: '',
    fecha_inicio: new Date().toLocaleDateString('es-CO').replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, '$1/$2/$3'),
    meses: '12',
  });
  const [generated, setGenerated] = useState(null);
  const [pdfResult, setPdfResult] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const all = await api.apartments.toArray();
      setApts(all);
      if (id) loadApt(Number(id), all);
    })();
  }, [id]);

  async function loadApt(aptId, aptsList) {
    const list = aptsList || await api.apartments.toArray();
    const a = list.find(x => x.id === aptId);
    if (!a) return;
    setApt(a);
    populateFromApt(a);
  }

  async function populateFromApt(a) {
    const allC = await api.contracts.toArray();
    const active = allC.find(c => c.apartmentId === a.id && (!c.endDate || new Date(c.endDate) > new Date()));
    if (active) {
      const allT = await api.tenants.toArray();
      const t = allT.find(t => t.id === active.tenantId);
      setTenant(t || null);
      setForm(prev => ({
        ...prev,
        apto: a.name,
        direccion: a.description || '',
        canon: String(a.monthlyRent || ''),
        deposito: String(a.depositAmount || ''),
        arrendatario_nombre: t?.name || '',
        arrendatario_cedula: t?.documentId || '',
      }));
    } else {
      setTenant(null);
      setForm(prev => ({ ...prev, apto: a.name }));
    }
  }

  async function handleAptSelect(aptId) {
    const a = apts.find(x => x.id === Number(aptId));
    if (!a) {
      setApt(null);
      setTenant(null);
      setForm(prev => ({ ...prev, apto: '', direccion: '', canon: '', deposito: '', arrendatario_nombre: '', arrendatario_cedula: '' }));
      return;
    }
    setApt(a);
    await populateFromApt(a);
    setGenerated(null);
    setError('');
  }

  function handleChange(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    setGenerated(null);
    setError('');
  }

  async function handleGenerate() {
    try {
      if (!form.arrendatario_nombre || !form.arrendatario_cedula || !form.apto) {
        setError('Faltan nombre, cedula del arrendatario o apartamento.');
        return;
      }
      if (!form.canon || !form.fecha_inicio) {
        setError('Faltan canon de arrendamiento o fecha de inicio.');
        return;
      }
      const fechaMatch = form.fecha_inicio.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!fechaMatch) {
        setError('La fecha debe tener formato dd/mm/aaaa. Ejemplo: 20/06/2026');
        return;
      }
      const dd = parseInt(fechaMatch[1]), mm = parseInt(fechaMatch[2]), yyyy = parseInt(fechaMatch[3]);
      if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || yyyy < 2000) {
        setError('Fecha invalida. Use formato dd/mm/aaaa');
        return;
      }
      const result = generateContractPDF(form);
      setPdfResult(result);
      if (isCapacitor()) {
        setGenerated('ready');
      } else {
        result.doc.save(result.filename);
        setGenerated('saved');
      }
      setError('');

      setSaving(true);
      try {
        const startDate = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        let endDate = null;
        if (form.meses) {
          const end = new Date(yyyy, mm + Number(form.meses) - 1, dd);
          endDate = end.toISOString().split('T')[0];
        }
        let tenantId = tenant?.id || null;
        if (!tenantId && form.arrendatario_nombre) {
          const allT = await api.tenants.toArray();
          const match = allT.find(t => t.documentId === form.arrendatario_cedula || t.name.toLowerCase() === form.arrendatario_nombre.toLowerCase());
          if (match) {
            tenantId = match.id;
          } else {
            const newT = await api.tenants.add({
              name: form.arrendatario_nombre,
              documentId: form.arrendatario_cedula,
              createdAt: new Date().toISOString(),
            });
            tenantId = newT.id;
          }
        }
        const newContract = await api.contracts.add({
          apartmentId: apt?.id || null,
          tenantId,
          startDate,
          endDate,
          monthlyRent: Number(form.canon.replace(/\./g, '')),
          depositAmount: Number(form.deposito.replace(/\./g, '')) || 0,
          depositPaid: false,
          createdAt: new Date().toISOString(),
        });
        const pdfFile = new File([result.blob], result.filename, { type: 'application/pdf' });
        const uploadResult = await api.uploadContract(pdfFile, newContract.id);
        await api.contracts.update(newContract.id, { contractFile: uploadResult.url });
        if (apt) await api.apartments.update(apt.id, { status: 'occupied' });
        setSaved(true);
      } catch (saveErr) {
        console.warn('Auto-save contract failed:', saveErr);
      }
      setSaving(false);
    } catch (e) {
      setError(e.message);
    }
  }

  async function sharePDF() {
    if (!pdfResult) return;
    try {
      if (isCapacitor()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({
          title: pdfResult.filename,
          text: `Contrato de arrendamiento - ${form.apto}`,
          files: [pdfResult.data],
          dialogTitle: 'Compartir Contrato',
        });
        setGenerated('shared');
      } else {
        const blob = pdfResult.blob;
        const file = new File([blob], pdfResult.filename, { type: 'application/pdf' });
        if (navigator.share && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: pdfResult.filename, text: `Contrato de arrendamiento - ${form.apto}` });
        } else {
          const waUrl = `https://wa.me/?text=${encodeURIComponent(`Contrato de arrendamiento - ${form.apto}`)}`;
          window.open(waUrl, '_blank');
        }
        setGenerated('shared');
      }
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <a href="/contracts" className="p-2 hover:bg-gray-200 rounded-lg transition-colors"><ArrowLeft className="w-5 h-5" /></a>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Generar Contrato</h1>
          <p className="text-gray-500 text-sm">Llena los datos y genera el PDF del contrato de arrendamiento</p>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {apt && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <strong>Apartamento:</strong> {apt.name} | <strong>Canon:</strong> ${(apt.monthlyRent || 0).toLocaleString()} |
          {tenant && <> <strong>Inquilino:</strong> {tenant.name}</>}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><FileText className="w-4 h-4" /> Arrendador (Propietario)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input type="text" value={form.propietario_nombre} onChange={e => handleChange('propietario_nombre', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cédula</label>
                <input type="text" value={form.propietario_cedula} onChange={e => handleChange('propietario_cedula', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expedida en</label>
                <input type="text" value={form.propietario_expedida} onChange={e => handleChange('propietario_expedida', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Cuenta Bancolombia</label>
              <input type="text" value={form.cuenta} onChange={e => handleChange('cuenta', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><FileText className="w-4 h-4" /> Arrendatario (Inquilino)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
              <input type="text" value={form.arrendatario_nombre} onChange={e => handleChange('arrendatario_nombre', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cédula *</label>
                <input type="text" value={form.arrendatario_cedula} onChange={e => handleChange('arrendatario_cedula', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expedida en</label>
                <input type="text" value={form.arrendatario_expedida} onChange={e => handleChange('arrendatario_expedida', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><FileText className="w-4 h-4" /> Inmueble</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Apartamento *</label>
              <select value={apt?.id || ''} onChange={e => handleAptSelect(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">-- Seleccionar --</option>
                {apts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
              <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">Carrera 10C no. 45B-37</p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><FileText className="w-4 h-4" /> Valores y Fechas</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Canon *</label>
              <input type="text" value={form.canon} onChange={e => handleChange('canon', e.target.value)} placeholder="1.000.000" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Depósito</label>
              <input type="text" value={form.deposito} onChange={e => handleChange('deposito', e.target.value)} placeholder="800.000" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duración (meses)</label>
              <input type="number" min="1" value={form.meses} onChange={e => handleChange('meses', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Inicio *</label>
              <input type="text" value={form.fecha_inicio} onChange={e => handleChange('fecha_inicio', e.target.value)} placeholder="dd/mm/aaaa" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
              <p className="text-xs text-gray-400 mt-1">Formato: dd/mm/aaaa</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
          <button onClick={handleGenerate} disabled={saving} className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50">
            <Download className="w-4 h-4" /> {saving ? 'Guardando...' : 'Generar PDF'}
          </button>
          {saved && <span className="text-sm text-emerald-600 self-center">Contrato guardado ✓</span>}
        {generated === 'ready' && (
          <button onClick={sharePDF} className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium">
            <Share2 className="w-4 h-4" /> Compartir o Guardar PDF
          </button>
        )}
        {generated === 'saved' && (
          <button onClick={sharePDF} className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium">
            <MessageCircle className="w-4 h-4" /> Compartir por WhatsApp
          </button>
        )}
        {generated === 'shared' && <p className="text-sm text-emerald-600 self-center">¡Compartido!</p>}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-500">
        <p>El canon puede escribirse como 1000000 o 1.000.000. Se convierte automáticamente a letras.</p>
        <p>Genera 18 cláusulas legales completas con firmas de arrendador y arrendatario.</p>
      </div>
    </div>
  );
}
