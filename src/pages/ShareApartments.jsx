import { useState, useEffect, useRef } from 'react';
import { Share2, Download, MessageCircle, Mail, Eye, EyeOff, RefreshCw, Home } from 'lucide-react';
import { api } from '../api';
import { photoUrl } from '../utils/config';
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

  function shareWhatsApp() {
    if (!html) return;
    const text = encodeURIComponent(`Apartamentos disponibles en ${campusName}
Mira la lista aquí: ${window.location.origin}/apartamentos-disponibles.html
O descarga el archivo desde la app.`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  function shareGmail() {
    if (!html) return;
    const subject = encodeURIComponent(`Apartamentos disponibles - ${campusName}`);
    const body = encodeURIComponent(`Hola,\n\nTe comparto los apartamentos disponibles en ${campusName}.\n\nPuedes ver la lista completa aquí:\n${window.location.origin}/apartamentos-disponibles.html\n\nSaludos.`);
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=&su=${subject}&body=${body}`, '_blank');
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
              <button onClick={shareWhatsApp} className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </button>
              <button onClick={shareGmail} className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors">
                <Mail className="w-4 h-4" />
                Gmail
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
