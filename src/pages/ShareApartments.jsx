import { useState, useEffect, useRef } from 'react';
import { Share2, Download, Eye, EyeOff, RefreshCw, Home } from 'lucide-react';
import { api } from '../api';
import { isCapacitor, photoUrl } from '../utils/config';
import { buildApartmentsHTML } from '../utils/generate-apartments-html';

export default function ShareApartments() {
  const [apartments, setApartments] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [campusName, setCampusName] = useState('Conjunto Residencial');
  const [count, setCount] = useState(0);
  const iframeRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const all = await api.apartments.toArray();
      const available = all.filter(a => a.status === 'vacant');
      setApartments(available);
      setCount(available.length);

      const allPhotos = await api.photos.toArray();
      setPhotos(allPhotos);

      const s = await api.settings?.toArray?.();
      if (s && s.length > 0 && s[0].campusName) {
        setCampusName(s[0].campusName);
      }
    } catch (e) {
      console.error('Error loading data:', e);
    }
  }

  function groupPhotosByAptId() {
    const map = {};
    for (const p of photos) {
      const aid = Number(p.apartmentId);
      if (!map[aid]) map[aid] = [];
      map[aid].push(p);
    }
    return map;
  }

  async function generate() {
    setLoading(true);
    try {
      const photosByAptId = groupPhotosByAptId();
      const h = await buildApartmentsHTML({ apartments, photosByAptId, campusName });
      setHtml(h);
    } catch (e) {
      console.error('Error generating HTML:', e);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (html && preview && iframeRef.current) {
      const blob = new Blob([html], { type: 'text/html' });
      iframeRef.current.src = URL.createObjectURL(blob);
    }
  }, [html, preview]);

  function downloadHTML() {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'apartamentos-disponibles.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function shareToWhatsApp() {
    if (apartments.length === 0) return;
    const photosByAptId = groupPhotosByAptId();
    const lines = [`Apartamentos disponibles en ${campusName}`];
    for (const a of apartments) {
      lines.push(`\n${a.name} - $${(a.monthlyRent || 0).toLocaleString()}${a.status === 'vacant' ? ' ✅ DISPONIBLE' : ''}`);
      if (a.description) lines.push(a.description);
      if (a.rooms || a.bathrooms) lines.push(`${a.rooms || '?'} hab / ${a.bathrooms || '?'} baños`);
      if (a.notes) lines.push(a.notes);
    }
    const text = lines.join('\n');
      const allUrls = apartments.flatMap(a => (photosByAptId[a.id] || []).map(p => photoUrl(p)).filter(Boolean));

    try {
      if (isCapacitor()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');
        const files = [];
        for (let i = 0; i < allUrls.length; i++) {
          try {
            const res = await fetch(allUrls[i]);
            const blob = await res.blob();
            const b64 = await new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(blob); });
            const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
            const r = await Filesystem.writeFile({ path: `apto_${i + 1}.${ext}`, data: b64.split(',')[1], directory: Directory.Cache });
            files.push(r.uri);
          } catch (e) { console.warn('[Share] Photo fetch failed:', allUrls[i], e); }
        }
        if (files.length > 0) {
          await Share.share({ text, files, dialogTitle: 'Compartir Apartamentos' });
          return;
        }
      }

      if (allUrls.length > 0) {
        try {
          const files = [];
          for (const url of allUrls) {
            try {
              const res = await fetch(url);
              const blob = await res.blob();
              const mime = blob.type || 'image/jpeg';
              const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
              files.push(new File([blob], `foto.${ext}`, { type: mime }));
            } catch (e) { console.warn('[Share] Photo fetch failed:', url, e); }
          }
          if (files.length > 0 && navigator.share && navigator.canShare && navigator.canShare({ files })) {
            await navigator.share({ files, text });
            return;
          }
        } catch (e) { if (e.name !== 'AbortError') console.warn('[Share] Web Share files failed:', e); }
      }

      if (navigator.share) {
        try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }

      const waText = allUrls.length > 0 ? text + '\n\n' + '📸 Fotos:\n' + allUrls.join('\n') : text;
      window.open(`https://wa.me/?text=${encodeURIComponent(waText)}`, '_blank');
    } catch (e) {
      console.error('Share error:', e);
      const waText = allUrls.length > 0 ? text + '\n\n' + '📸 Fotos:\n' + allUrls.join('\n') : text;
      window.open(`https://wa.me/?text=${encodeURIComponent(waText)}`, '_blank');
    }
  }

  async function handlePrintPDF() {
    if (!html) return;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 500);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Share2 className="w-6 h-6" />
            Compartir Apartamentos
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {count} apartamento{count !== 1 ? 's' : ''} disponible{count !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={loadData} className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-gray-100 transition-colors" title="Recargar">
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del conjunto</label>
        <input
          type="text"
          value={campusName}
          onChange={e => setCampusName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {!html && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Home className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">
            Se encontraron <strong>{count}</strong> apartamento{count !== 1 ? 's' : ''} disponible{count !== 1 ? 's' : ''}.
            {count === 0 ? ' Marca apartamentos como "Disponible" para que aparezcan aquí.' : ''}
          </p>
          <button
            onClick={generate}
            disabled={count === 0 || loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Generando...' : 'Generar Vista Previa'}
          </button>
        </div>
      )}

      {html && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setPreview(!preview)} className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                {preview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {preview ? 'Ocultar Vista' : 'Vista Previa'}
              </button>
              <button onClick={downloadHTML} className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                <Download className="w-4 h-4" />
                Descargar HTML
              </button>
              <button onClick={handlePrintPDF} className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors">
                <Download className="w-4 h-4" />
                Guardar como PDF
              </button>
              <button onClick={shareToWhatsApp} className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                <Share2 className="w-4 h-4" />
                Compartir por WhatsApp
              </button>
              <button onClick={generate} disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors">
                <RefreshCw className="w-4 h-4" />
                Regenerar
              </button>
            </div>
          </div>

          {preview && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <iframe ref={iframeRef} className="w-full h-[600px]" title="Vista previa" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
