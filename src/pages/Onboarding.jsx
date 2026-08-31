import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Download, FileText, FileUp, Info, Loader2,
  Save, Sparkles, Trash2, UserPlus,
} from 'lucide-react';
import { AUTH_TOKEN, getBase } from '../utils/config';

async function templateRequest(path = '', options = {}) {
  const response = await fetch(`${getBase()}/contract-templates${path}`, {
    ...options,
    headers: {
      'x-auth-token': AUTH_TOKEN,
      ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (options.asBlob && response.ok) return response.blob();
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la solicitud.');
  return payload;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Onboarding() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [manualVariables, setManualVariables] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [draftVariables, setDraftVariables] = useState('');
  const [values, setValues] = useState({});

  const selected = useMemo(
    () => templates.find(template => Number(template.id) === Number(selectedId)) || null,
    [templates, selectedId],
  );

  async function loadTemplates() {
    try {
      setError('');
      const result = await templateRequest();
      setTemplates(Array.isArray(result) ? result : []);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadTemplates(); }, []);

  function chooseTemplate(template) {
    setSelectedId(template.id);
    setDraftVariables((template.manualVariables || []).join('\n'));
    setValues(Object.fromEntries((template.variables || []).map(variable => [variable, ''])));
    setError('');
    setNotice('');
  }

  async function uploadTemplate(event) {
    event.preventDefault();
    if (!file) return setError('Selecciona un archivo PDF o Word .docx.');
    setBusy('upload');
    setError('');
    setNotice('');
    try {
      const body = new FormData();
      body.append('template', file);
      body.append('name', name || file.name.replace(/\.[^.]+$/, ''));
      body.append('manualVariables', JSON.stringify(manualVariables.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean)));
      const created = await templateRequest('', { method: 'POST', body });
      setTemplates(current => [...current, created]);
      chooseTemplate(created);
      setFile(null);
      setName('');
      setManualVariables('');
      event.currentTarget.reset();
      setNotice(`Plantilla “${created.name}” guardada y analizada.`);
    } catch (uploadError) { setError(uploadError.message); }
    finally { setBusy(''); }
  }

  async function saveVariables() {
    if (!selected) return;
    setBusy(`save-${selected.id}`);
    setError('');
    try {
      const updated = await templateRequest(`/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({ manualVariables: draftVariables.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean) }),
      });
      setTemplates(current => current.map(item => item.id === updated.id ? updated : item));
      chooseTemplate(updated);
      setNotice('Variables manuales guardadas. Se recuperarán desde cualquier dispositivo.');
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(''); }
  }

  async function downloadOriginal(template) {
    setBusy(`download-${template.id}`);
    setError('');
    try {
      const blob = await templateRequest(`/${template.id}/file`, { asBlob: true });
      downloadBlob(blob, template.originalName || `${template.name}.${template.format}`);
    } catch (downloadError) { setError(downloadError.message); }
    finally { setBusy(''); }
  }

  async function generateDocument() {
    if (!selected) return;
    setBusy(`generate-${selected.id}`);
    setError('');
    try {
      const blob = await templateRequest(`/${selected.id}/generate`, {
        method: 'POST', body: JSON.stringify({ values }), asBlob: true,
      });
      downloadBlob(blob, `${selected.name}-generado.${selected.format}`);
      setNotice('Documento generado. La plantilla original permanece intacta.');
    } catch (generateError) { setError(generateError.message); }
    finally { setBusy(''); }
  }

  async function removeTemplate(template) {
    if (!window.confirm(`¿Eliminar la plantilla “${template.name}”? El archivo se quitará del almacenamiento permanente.`)) return;
    setBusy(`delete-${template.id}`);
    setError('');
    try {
      await templateRequest(`/${template.id}`, { method: 'DELETE' });
      setTemplates(current => current.filter(item => item.id !== template.id));
      if (selectedId === template.id) setSelectedId(null);
      setNotice('Plantilla eliminada.');
    } catch (deleteError) { setError(deleteError.message); }
    finally { setBusy(''); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="rounded-3xl bg-gradient-to-br from-slate-900 via-blue-950 to-blue-700 p-6 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/15 p-3"><UserPlus className="h-7 w-7" /></div>
          <div>
            <h1 className="text-2xl font-bold">Onboarding y plantillas</h1>
            <p className="mt-1 text-sm text-blue-100">Centraliza la plantilla, sus variables y la generación del contrato.</p>
          </div>
        </div>
      </header>

      {(error || notice) && (
        <div className={`rounded-2xl border p-4 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {error || notice}
        </div>
      )}

      <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={uploadTemplate} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><FileUp className="h-5 w-5 text-blue-600" /> Subir plantilla</h2>
            <p className="mt-1 text-sm text-slate-500">Word: escribe variables como <code className="rounded bg-slate-100 px-1">{'{{nombre_inquilino}}'}</code>. PDF: usa campos rellenables.</p>
          </div>
          <label className="block text-sm font-medium text-slate-700">Nombre de la plantilla
            <input value={name} onChange={event => setName(event.target.value)} placeholder="Contrato de arrendamiento" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500" />
          </label>
          <label className="block text-sm font-medium text-slate-700">Archivo PDF o Word .docx
            <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => setFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded-xl border border-dashed border-slate-300 p-3 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">Variables manuales opcionales
            <textarea value={manualVariables} onChange={event => setManualVariables(event.target.value)} rows={3} placeholder={'Una por línea\nnumero_apartamento\nvalor_canon'} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500" />
          </label>
          <button disabled={busy === 'upload'} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-60">
            {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} Analizar y guardar
          </button>
          <div className="flex gap-2 rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Los PDF escaneados o planos se guardan, pero para completarlos automáticamente deben tener campos de formulario. Las variables manuales quedan persistidas y no se pierden al cambiar de dispositivo.</span>
          </div>
        </form>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><FileText className="h-5 w-5 text-blue-600" /> Plantillas guardadas</h2>
          {loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div> : templates.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">Todavía no hay plantillas.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {templates.map(template => (
                <article key={template.id} className={`rounded-2xl border p-4 ${selectedId === template.id ? 'border-blue-400 bg-blue-50/50' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => chooseTemplate(template)} className="min-w-0 flex-1 text-left">
                      <p className="truncate font-semibold text-slate-900">{template.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{template.format.toUpperCase()} · {template.variables.length} variable(s) · {template.supportsGeneration ? 'Generación automática' : 'Configuración manual'}</p>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => downloadOriginal(template)} title="Descargar original" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Download className="h-4 w-4" /></button>
                      <button onClick={() => removeTemplate(template)} title="Eliminar" className="rounded-lg p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {selected && (
        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Variables de “{selected.name}”</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(selected.detectedVariables || []).map(variable => <span key={variable} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800"><CheckCircle2 className="mr-1 inline h-3 w-3" />{variable}</span>)}
              {selected.detectedVariables.length === 0 && <span className="text-sm text-slate-500">No se detectaron variables automáticas.</span>}
            </div>
            <label className="mt-5 block text-sm font-medium text-slate-700">Añadir o recuperar variables manuales
              <textarea value={draftVariables} onChange={event => setDraftVariables(event.target.value)} rows={6} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500" />
            </label>
            <button onClick={saveVariables} disabled={busy === `save-${selected.id}`} className="mt-3 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              <Save className="h-4 w-4" /> Guardar variables
            </button>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-bold text-slate-900"><Sparkles className="h-5 w-5 text-violet-600" /> Probar generación</h2>
            {selected.variables.length === 0 ? <p className="mt-4 text-sm text-slate-500">Añade al menos una variable.</p> : (
              <div className="mt-4 max-h-[420px] space-y-3 overflow-auto pr-1">
                {selected.variables.map(variable => (
                  <label key={variable} className="block text-xs font-medium text-slate-600">{variable}
                    <input value={values[variable] || ''} onChange={event => setValues(current => ({ ...current, [variable]: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500" />
                  </label>
                ))}
              </div>
            )}
            <button onClick={generateDocument} disabled={!selected.supportsGeneration || busy === `generate-${selected.id}`} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {busy === `generate-${selected.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Generar documento
            </button>
            {!selected.supportsGeneration && <p className="mt-2 text-xs text-amber-700">Este PDF no tiene campos rellenables. Puedes conservar sus variables manuales, pero debes añadir campos al PDF o usar una plantilla .docx para generarlo automáticamente.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
