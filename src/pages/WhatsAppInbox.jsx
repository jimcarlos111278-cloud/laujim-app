import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Download, FileText, Image, Lock, MessageCircle, Mic, Paperclip, Phone, RefreshCw, Send, Square, Video, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AUTH_TOKEN, getBase } from '../utils/config';

async function cloudRequest(path, options = {}) {
  const response = await fetch(getBase() + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No fue posible completar la solicitud');
  return data;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

function MediaIcon({ type, className = 'w-4 h-4' }) {
  if (type === 'image') return <Image className={className} />;
  if (type === 'audio') return <AudioLines className={className} />;
  if (type === 'video') return <Video className={className} />;
  return <FileText className={className} />;
}

function MediaMessage({ message }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const kind = message.type === 'sticker' ? 'image' : message.type;
  const hasMedia = Boolean(message.mediaId) && ['image', 'audio', 'video', 'document', 'sticker'].includes(message.type);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!hasMedia) return null;

  async function loadMedia(download = false) {
    setLoading(true); setError('');
    try {
      const response = await fetch(getBase() + `/whatsapp/cloud/messages/${message.id}/media`, { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No fue posible descargar el archivo');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (download || kind === 'document') {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = message.media?.fileName || `whatsapp-${message.id}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      } else {
        if (url) URL.revokeObjectURL(url);
        setUrl(objectUrl);
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  const fileName = message.media?.fileName || (message.media?.voice ? 'Nota de voz' : `Archivo ${message.type}`);
  return <div className="mt-2 space-y-2">
    {url && kind === 'image' && <img src={url} alt={fileName} className="max-h-72 rounded-lg object-contain bg-black/5" />}
    {url && kind === 'audio' && <audio controls src={url} className="max-w-full" />}
    {url && kind === 'video' && <video controls src={url} className="max-h-72 max-w-full rounded-lg bg-black" />}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => loadMedia(kind === 'document')} disabled={loading} className="inline-flex items-center gap-1 rounded-md border border-current/25 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-60">
        <MediaIcon type={kind} className="w-3.5 h-3.5" /> {loading ? 'Cargando…' : kind === 'document' ? 'Descargar archivo' : url ? 'Volver a cargar' : `Ver ${kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : 'imagen'}`}
      </button>
      {kind !== 'document' && <button type="button" onClick={() => loadMedia(true)} disabled={loading} className="inline-flex items-center gap-1 rounded-md border border-current/25 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-60"><Download className="w-3.5 h-3.5" /> Descargar</button>}
      <span className="text-[10px] opacity-70 truncate max-w-52">{fileName}</span>
    </div>
    {error && <p className="text-xs text-red-600">{error}</p>}
  </div>;
}

export default function WhatsAppInbox() {
  const [searchParams] = useSearchParams();
  const requestedConversation = Number(searchParams.get('conversation')) || null;
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const fileInput = useRef(null);
  const recorderRef = useRef(null);
  const recorderStreamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const recordingChunksRef = useRef([]);

  const loadConversations = useCallback(async () => {
    try {
      const [nextStatus, nextConversations] = await Promise.all([
        cloudRequest('/whatsapp/cloud/status'),
        cloudRequest('/whatsapp/cloud/conversations'),
      ]);
      setStatus(nextStatus);
      setConversations(nextConversations);
      setError('');
      setSelected(current => {
        if (requestedConversation && nextConversations.some(c => c.id === requestedConversation)) return requestedConversation;
        if (current && nextConversations.some(c => c.id === current)) return current;
        return nextConversations[0]?.id || null;
      });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [requestedConversation]);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) return setMessages([]);
    try { setMessages(await cloudRequest(`/whatsapp/cloud/conversations/${conversationId}/messages`)); }
    catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { loadConversations(); const timer = setInterval(loadConversations, 15000); return () => clearInterval(timer); }, [loadConversations]);
  useEffect(() => { loadMessages(selected); }, [selected, loadMessages]);

  const selectedConversation = conversations.find(c => c.id === selected);
  const windowOpen = selectedConversation?.customerServiceWindowUntil && new Date(selectedConversation.customerServiceWindowUntil) > new Date();

  function clearAttachment() {
    setAttachment(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  async function startRecording() {
    if (!windowOpen || sending || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Este navegador no permite grabar notas de voz. Adjunta un audio en su lugar.');
      return;
    }
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supportsType = typeof MediaRecorder.isTypeSupported === 'function';
      const mimeType = supportsType && ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorderStreamRef.current = stream;
      recorder.ondataavailable = event => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        stream.getTracks().forEach(track => track.stop());
        recorderStreamRef.current = null;
        setRecording(false);
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const extension = type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(recordingChunksRef.current, { type });
        if (blob.size) setAttachment(new File([blob], `nota-de-voz.${extension}`, { type }));
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecordingSeconds(0);
      setRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds(seconds => {
        const next = seconds + 1;
        if (next >= 600) stopRecording();
        return next;
      }), 1000);
    } catch (err) { setError(err.name === 'NotAllowedError' ? 'Necesitas permitir el micrófono para grabar.' : err.message || 'No fue posible iniciar la grabación.'); }
  }

  useEffect(() => () => {
    clearInterval(recordingTimerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function sendMessage(event) {
    event.preventDefault();
    if (!selected || !windowOpen || sending || recording || (!draft.trim() && !attachment)) return;
    setSending(true);
    try {
      let result;
      if (attachment) {
        const form = new FormData();
        form.append('conversationId', String(selected));
        form.append('caption', draft.trim());
        form.append('file', attachment);
        const response = await fetch(getBase() + '/whatsapp/cloud/send-media', { method: 'POST', headers: { 'x-auth-token': AUTH_TOKEN }, body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No fue posible enviar el archivo');
        result = data;
        clearAttachment();
      } else {
        result = await cloudRequest('/whatsapp/cloud/send', { method: 'POST', body: JSON.stringify({ conversationId: selected, text: draft.trim() }) });
      }
      setDraft('');
      if (result?.message) {
        setMessages(current => current.some(message => message.id === result.message.id) ? current : [...current, result.message]);
        setConversations(current => current.map(conversation => conversation.id === selected
          ? { ...conversation, messages: [result.message] }
          : conversation));
      }
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  }

  return (
    <div className="p-4 md:p-6 h-full flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><MessageCircle className="w-6 h-6 text-emerald-600" /> WhatsApp Cloud</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Conversaciones de residentes autorizados. Los mensajes no autorizados no se muestran aquí.</p>
        </div>
        <button onClick={loadConversations} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"><RefreshCw className="w-4 h-4" /> Actualizar</button>
      </div>

      {status && <div className={`text-sm rounded-lg px-3 py-2 ${status.ready ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-800'}`}>
        Cloud API: {status.ready ? 'conectada' : 'requiere configuración'} · {status.conversations} conversación(es) · {status.quarantined} autenticación(es) pendientes
      </div>}
      {error && <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm">{error}</div>}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_1fr] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <aside className="border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700 overflow-auto max-h-52 lg:max-h-none">
          {loading ? <p className="p-4 text-sm text-gray-500">Cargando conversaciones…</p> : conversations.length === 0 ? <p className="p-4 text-sm text-gray-500">Aún no hay mensajes autorizados.</p> : conversations.map(conversation => (
            <button key={conversation.id} onClick={() => setSelected(conversation.id)} className={`w-full text-left p-4 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 ${selected === conversation.id ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>
              <div className="font-medium text-gray-900 dark:text-white">{conversation.tenantName || 'Inquilino autorizado'}</div>
              <div className="text-xs text-gray-500 mt-1">{conversation.phone} · Apto. {conversation.apartmentName || conversation.apartmentId || '—'} · {formatDate(conversation.lastInboundAt)}</div>
              <div className={`text-xs mt-1 ${conversation.customerServiceWindowUntil && new Date(conversation.customerServiceWindowUntil) > new Date() ? 'text-emerald-600' : 'text-amber-600'}`}>{conversation.customerServiceWindowUntil && new Date(conversation.customerServiceWindowUntil) > new Date() ? 'Ventana de respuesta activa' : 'Se requiere plantilla'}</div>
            </button>
          ))}
        </aside>

        <section className="min-h-0 flex flex-col">
          {!selectedConversation ? <div className="m-auto text-center text-gray-500"><Lock className="w-8 h-8 mx-auto mb-2" />Selecciona una conversación.</div> : <>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3"><div><p className="font-semibold text-gray-900 dark:text-white">{selectedConversation.tenantName || 'Inquilino autorizado'}</p><p className="text-xs text-gray-500">{selectedConversation.phone} · Apartamento {selectedConversation.apartmentName || selectedConversation.apartmentId || '—'}</p></div><a href={`tel:+${selectedConversation.phone}`} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"><Phone className="w-4 h-4" /> Llamar</a></div>
            <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900/40">
              {messages.length === 0 ? <p className="text-sm text-gray-500 text-center pt-8">Aún no hay mensajes.</p> : messages.map(message => (
                <div key={message.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${message.direction === 'out' ? 'ml-auto bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600'}`}>
                  {message.text && <p>{message.text}</p>}
                  {!message.text && !message.mediaId && <p>{message.type === 'text' ? 'Mensaje sin texto' : `Mensaje ${message.type || ''}`}</p>}
                  <MediaMessage message={message} />
                  <p className={`text-[10px] mt-1 ${message.direction === 'out' ? 'text-emerald-100' : 'text-gray-400'}`}>{formatDate(message.createdAt)}</p>
                </div>
              ))}
            </div>
            <form onSubmit={sendMessage} className="p-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
              {attachment && <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-100 dark:bg-gray-700 px-3 py-2 text-xs"><span className="truncate flex items-center gap-2"><MediaIcon type={attachment.type.startsWith('image/') ? 'image' : attachment.type.startsWith('audio/') ? 'audio' : attachment.type.startsWith('video/') ? 'video' : 'document'} className="w-4 h-4" />{attachment.name} · {(attachment.size / (1024 * 1024)).toFixed(1)} MB</span><button type="button" onClick={clearAttachment} className="p-1"><X className="w-4 h-4" /></button></div>}
              <div className="flex gap-2">
                {recording ? <button type="button" onClick={stopRecording} title="Detener grabación" className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-red-600 text-white"><Square className="w-4 h-4" /> <span className="text-xs tabular-nums">{String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</span></button> : <button type="button" onClick={startRecording} disabled={!windowOpen || sending} title="Grabar nota de voz" className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50"><Mic className="w-4 h-4" /></button>}
                <input ref={fileInput} type="file" className="hidden" accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={event => setAttachment(event.target.files?.[0] || null)} />
                <button type="button" onClick={() => fileInput.current?.click()} disabled={!windowOpen || sending || recording} title="Adjuntar imagen, audio, video o documento (máx. 16 MB)" className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50"><Paperclip className="w-4 h-4" /></button>
                <input value={draft} onChange={e => setDraft(e.target.value)} disabled={!windowOpen || sending || recording} placeholder={recording ? 'Grabando nota de voz…' : windowOpen ? attachment ? 'Añade un texto opcional…' : 'Escribe una respuesta…' : 'La ventana de 24 h terminó: usa una plantilla aprobada'} className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm disabled:opacity-60" />
                <button disabled={recording || (!draft.trim() && !attachment) || !windowOpen || sending} title={attachment ? 'Enviar archivo' : 'Enviar mensaje'} className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"><Send className="w-4 h-4" /></button>
              </div>
              <p className="text-[11px] text-gray-500">Imágenes, notas de voz, videos y documentos · máximo 16 MB · solo durante la ventana activa de 24 h.</p>
            </form>
          </>}
        </section>
      </div>
    </div>
  );
}
