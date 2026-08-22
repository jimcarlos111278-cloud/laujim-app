import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, AudioLines, Bell, Camera, CheckCheck, Download, FileText, Image, Lock, MessageCircle, Mic, Paperclip, RefreshCw, Search, Send, Settings2, Smile, Square, Video, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  useEffect(() => {
    if (!hasMedia || kind === 'document') return undefined;
    loadMedia(false);
    return undefined;
  }, [message.id, message.mediaId, kind, hasMedia]);
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
        <MediaIcon type={kind} className="w-3.5 h-3.5" /> {loading ? 'Cargando vista previa…' : kind === 'document' ? 'Descargar archivo' : url ? 'Volver a cargar' : `Ver ${kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : 'imagen'}`}
      </button>
      {kind !== 'document' && <button type="button" onClick={() => loadMedia(true)} disabled={loading} className="inline-flex items-center gap-1 rounded-md border border-current/25 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-60"><Download className="w-3.5 h-3.5" /> Descargar</button>}
      <span className="text-[10px] opacity-70 truncate max-w-52">{fileName}</span>
    </div>
    {error && <p className="text-xs text-red-600">{error}</p>}
  </div>;
}

function apartmentBadge(conversation) {
  const value = String(conversation?.apartmentName || conversation?.apartmentId || '—');
  const numbers = value.match(/\d+/g);
  return numbers ? numbers.join('') : value.slice(0, 4);
}

function attachmentKind(file) {
  if (file?.type?.startsWith('image/')) return 'image';
  if (file?.type?.startsWith('audio/')) return 'audio';
  if (file?.type?.startsWith('video/')) return 'video';
  return 'document';
}

export default function WhatsAppInbox() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedConversation = Number(searchParams.get('conversation')) || null;
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSending, setTemplateSending] = useState('');
  const [windowClock, setWindowClock] = useState(Date.now());
  const [searchQuery, setSearchQuery] = useState('');
  const [listFilter, setListFilter] = useState('all');
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
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
        return null;
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
  useEffect(() => {
    const timer = setInterval(() => setWindowClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const selectedConversation = conversations.find(c => c.id === selected);
  const windowUntil = selectedConversation?.customerServiceWindowUntil ? new Date(selectedConversation.customerServiceWindowUntil) : null;
  const windowOpen = Boolean(windowUntil && windowUntil.getTime() > windowClock);
  const windowRemainingMs = windowOpen ? windowUntil.getTime() - windowClock : 0;

  function windowRemainingLabel() {
    if (!windowOpen) return 'Ventana cerrada · usa una plantilla aprobada';
    const totalMinutes = Math.max(1, Math.ceil(windowRemainingMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `Ventana activa · quedan ${hours} h ${minutes} min` : `Ventana activa · quedan ${minutes} min`;
  }

  function listTime(value) {
    if (!value) return '';
    const date = new Date(value);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
  }

  function previewText(conversation) {
    const message = conversation?.messages?.[0];
    if (!message) return 'Sin mensajes todavía';
    if (message.text) return message.text;
    if (message.type === 'image') return '📷 Foto';
    if (message.type === 'video') return '🎥 Video';
    if (message.type === 'audio') return '🎙 Nota de voz';
    if (message.type === 'document') return '📄 Documento';
    return 'Mensaje multimedia';
  }

  const visibleConversations = conversations.filter(conversation => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const haystack = [conversation.tenantName, conversation.phone, conversation.apartmentName, conversation.apartmentId].filter(Boolean).join(' ').toLocaleLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const unread = Number(conversation.unreadCount || 0) > 0;
    return matchesQuery && (listFilter !== 'unread' || unread);
  });

  function openConversation(conversationId) {
    setSelected(conversationId);
    setShowTemplates(false);
    navigate(`/whatsapp?conversation=${conversationId}`);
  }

  function returnToConversationList() {
    setSelected(null);
    setShowTemplates(false);
    navigate('/whatsapp');
  }

  function clearAttachment() {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    setAttachment(null);
    setAttachmentPreviewUrl('');
    if (fileInput.current) fileInput.current.value = '';
  }

  function handleAttachmentFile(file) {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    setAttachment(file);
    setAttachmentPreviewUrl(file && ['image', 'audio', 'video'].includes(attachmentKind(file)) ? URL.createObjectURL(file) : '');
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
        if (blob.size) handleAttachmentFile(new File([blob], `nota-de-voz.${extension}`, { type }));
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

  async function sendTemplate(template) {
    if (!selected || templateSending) return;
    setTemplateSending(template);
    setError('');
    try {
      const result = await cloudRequest('/whatsapp/cloud/send-template', {
        method: 'POST', body: JSON.stringify({ conversationId: selected, template }),
      });
      if (result?.message) {
        setMessages(current => current.some(message => message.id === result.message.id) ? current : [...current, result.message]);
        setConversations(current => current.map(conversation => conversation.id === selected
          ? { ...conversation, messages: [result.message] }
          : conversation));
      }
      setShowTemplates(false);
    } catch (err) { setError(err.message); }
    finally { setTemplateSending(''); }
  }

  return (
    <div className={`wa-live-shell ${selected ? 'wa-live-selected' : ''}`}>
      <aside className="wa-live-sidebar">
        <div className="wa-live-list-top">
          <h1><MessageCircle className="w-6 h-6" /> WhatsApp</h1>
          <div className="wa-live-top-actions">
            <button type="button" onClick={loadConversations} className="wa-live-icon" title="Actualizar conversaciones" aria-label="Actualizar conversaciones"><RefreshCw className="w-4 h-4" /></button>
            <button type="button" onClick={() => navigate('/settings')} className="wa-live-icon" title="Configuración" aria-label="Configuración"><Settings2 className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="wa-live-search"><Search className="w-4 h-4" /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Buscar contactos o apartamentos" aria-label="Buscar contactos o apartamentos" /></div>
        <div className="wa-live-tabs">
          <button type="button" onClick={() => setListFilter('all')} className={listFilter === 'all' ? 'active' : ''}>Todos</button>
          <button type="button" onClick={() => setListFilter('unread')} className={listFilter === 'unread' ? 'active' : ''}>No leídos</button>
        </div>
        <div className="wa-live-archived"><Archive className="w-5 h-5" /><strong>Archivados</strong><span>—</span></div>
        <div className="wa-live-api-status">
          <span className={status?.ready ? 'online' : 'offline'} />
          {status?.ready ? 'Cloud API conectada' : 'Cloud API requiere configuración'}
        </div>
        {error && <div className="wa-live-error">{error}</div>}
        <div className="wa-live-conversation-list">
          {loading ? <p className="wa-live-empty">Cargando conversaciones…</p> : !visibleConversations.length ? <p className="wa-live-empty">{listFilter === 'unread' ? 'No hay conversaciones sin leer.' : conversations.length ? 'No hay coincidencias.' : 'Aún no hay mensajes autorizados.'}</p> : visibleConversations.map(conversation => {
            const conversationWindowOpen = conversation.customerServiceWindowUntil && new Date(conversation.customerServiceWindowUntil) > new Date();
            return <button key={conversation.id} type="button" onClick={() => openConversation(conversation.id)} className={`wa-live-row ${selected === conversation.id ? 'selected' : ''}`}>
              <span className="wa-live-avatar">{apartmentBadge(conversation)}</span>
              <span className="wa-live-row-main">
                <span className="wa-live-row-head"><strong>{conversation.tenantName || 'Inquilino autorizado'}</strong><time>{listTime(conversation.lastInboundAt || conversation.messages?.[0]?.createdAt)}</time></span>
                <span className="wa-live-row-preview">{previewText(conversation)}</span>
                <span className={`wa-live-row-status ${conversationWindowOpen ? 'open' : 'closed'}`}>{conversationWindowOpen ? 'Ventana activa' : 'Requiere plantilla'} · Apto. {conversation.apartmentName || conversation.apartmentId || '—'}</span>
              </span>
            </button>;
          })}
        </div>
        <div className="wa-live-sidebar-note">Canal oficial · solo conversaciones de residentes autorizados</div>
      </aside>

      <section className="wa-live-chat">
        {!selectedConversation ? <div className="wa-live-empty-chat"><Lock className="w-10 h-10" /><strong>Selecciona una conversación</strong><span>Busca un inquilino o apartamento para comenzar.</span></div> : <>
          <div className="wa-live-chat-head">
            <button type="button" onClick={returnToConversationList} className="wa-live-icon wa-live-mobile-only" aria-label="Volver a conversaciones"><ArrowLeft className="w-5 h-5" /></button>
            <span className="wa-live-avatar large">{apartmentBadge(selectedConversation)}</span>
            <div className="wa-live-chat-person"><strong>{selectedConversation.tenantName || 'Inquilino autorizado'}</strong><span>{selectedConversation.phone} · Apartamento {selectedConversation.apartmentName || selectedConversation.apartmentId || '—'}</span></div>
            <div className="wa-live-chat-actions">
              <button type="button" onClick={() => setShowTemplates(open => !open)} className={`wa-live-icon ${!windowOpen ? 'danger' : ''}`} title={!windowOpen ? 'La ventana de Meta está cerrada: elegir plantilla' : 'Enviar plantilla'} aria-label={!windowOpen ? 'Elegir plantilla' : 'Enviar plantilla'}><FileText className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="wa-live-chat-state"><span className={windowOpen ? 'open' : 'closed'} />{windowRemainingLabel()}</div>
          {showTemplates && <div className="wa-live-template-panel">
            <div><strong>Plantillas aprobadas por Meta</strong><span>Úsalas cuando la ventana esté cerrada. La escritura se habilita cuando el inquilino responda.</span></div>
            <div className="wa-live-template-actions">
              <button type="button" disabled={!!templateSending} onClick={() => sendTemplate('greeting')}>{templateSending === 'greeting' ? 'Enviando…' : 'Hola, ¿cómo estás?'}</button>
              <button type="button" disabled={!!templateSending} onClick={() => sendTemplate('payment_reminder')}>{templateSending === 'payment_reminder' ? 'Enviando…' : 'Cobro + servicios'}</button>
            </div>
          </div>}
          <div className="wa-live-messages">
            {messages.length === 0 ? <p className="wa-live-empty">Aún no hay mensajes.</p> : messages.map(message => (
              <div key={message.id} className={`wa-live-bubble ${message.direction === 'out' ? 'out' : 'in'}`}>
                {message.text && <p>{message.text}</p>}
                {!message.text && !message.mediaId && <p>{message.type === 'text' ? 'Mensaje sin texto' : `Mensaje ${message.type || ''}`}</p>}
                <MediaMessage message={message} />
                <div className="wa-live-bubble-meta">{formatDate(message.createdAt)} {message.direction === 'out' && <CheckCheck className="w-3.5 h-3.5" />}</div>
              </div>
            ))}
          </div>
          <form onSubmit={sendMessage} className="wa-live-compose-wrap">
            <div className={`wa-live-compose-status ${windowOpen ? 'open' : 'closed'}`}><span>{windowOpen ? 'Puedes responder libremente' : 'La ventana está cerrada'}</span><small>{windowOpen ? 'Mensajes, fotos, videos y notas de voz' : 'El botón rojo abre las plantillas'}</small></div>
            {attachment && <div className="wa-live-attachment">
              <div className="wa-live-attachment-head"><span><MediaIcon type={attachmentKind(attachment)} className="w-4 h-4" />{attachment.name} · {(attachment.size / (1024 * 1024)).toFixed(1)} MB</span><button type="button" onClick={clearAttachment} aria-label="Quitar archivo"><X className="w-4 h-4" /></button></div>
              {attachmentPreviewUrl && attachmentKind(attachment) === 'image' && <img src={attachmentPreviewUrl} alt="Vista previa del archivo" />}
              {attachmentPreviewUrl && attachmentKind(attachment) === 'video' && <video src={attachmentPreviewUrl} controls />}
              {attachmentPreviewUrl && attachmentKind(attachment) === 'audio' && <audio src={attachmentPreviewUrl} controls />}
            </div>}
            <div className="wa-live-compose">
              {recording ? <button type="button" onClick={stopRecording} title="Detener grabación" className="wa-live-control recording"><Square className="w-4 h-4" /><span>{String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</span></button> : <button type="button" onClick={startRecording} disabled={!windowOpen || sending} title="Grabar nota de voz" className="wa-live-control"><Mic className="w-4 h-4" /></button>}
              <input ref={fileInput} type="file" className="hidden" accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={event => handleAttachmentFile(event.target.files?.[0] || null)} />
              <input ref={cameraInput} type="file" className="hidden" accept="image/*,video/*" capture="environment" onChange={event => handleAttachmentFile(event.target.files?.[0] || null)} />
              <button type="button" onClick={() => cameraInput.current?.click()} disabled={!windowOpen || sending || recording} title="Tomar foto o video" className="wa-live-control"><Camera className="w-4 h-4" /></button>
              <button type="button" onClick={() => fileInput.current?.click()} disabled={!windowOpen || sending || recording} title="Adjuntar imagen, audio, video o documento (máx. 16 MB)" className="wa-live-control"><Paperclip className="w-4 h-4" /></button>
              <button type="button" onClick={() => setDraft(current => `${current}😊`)} disabled={!windowOpen || sending || recording} title="Añadir emoji" className="wa-live-control wa-live-optional"><Smile className="w-4 h-4" /></button>
              <input value={draft} onChange={event => setDraft(event.target.value)} disabled={!windowOpen || sending || recording} placeholder={recording ? 'Grabando nota de voz…' : windowOpen ? attachment ? 'Añade un texto opcional…' : 'Escribe un mensaje' : 'Escritura bloqueada hasta que respondan'} />
              <button type={windowOpen ? 'submit' : 'button'} onClick={() => { if (!windowOpen) setShowTemplates(true); }} disabled={windowOpen ? (recording || (!draft.trim() && !attachment) || sending) : !!templateSending} title={windowOpen ? (attachment ? 'Enviar archivo' : 'Enviar mensaje') : 'La ventana de Meta está cerrada: elegir plantilla'} aria-label={windowOpen ? 'Enviar mensaje' : 'Elegir plantilla'} className={`wa-live-send ${windowOpen ? 'open' : 'closed'}`}>
                {windowOpen ? <Send className="w-4 h-4" /> : <FileText className="w-4 h-4" />}<span>{windowOpen ? 'Enviar' : 'Plantillas'}</span>
              </button>
            </div>
            <p className="wa-live-compose-help">Los archivos y mensajes libres solo se envían durante la ventana activa indicada por Meta.</p>
          </form>
        </>}
      </section>

      {selectedConversation && <aside className="wa-live-details">
        <div className="wa-live-details-head"><strong>Información</strong><span>·</span></div>
        <div className="wa-live-profile"><span className="wa-live-avatar xl">{apartmentBadge(selectedConversation)}</span><strong>{selectedConversation.tenantName || 'Inquilino autorizado'}</strong><span>Canal oficial · Apartamento {selectedConversation.apartmentName || selectedConversation.apartmentId || '—'}</span></div>
        <div className="wa-live-details-section"><small>Estado de la conversación</small><p className={windowOpen ? 'open' : 'closed'}>● {windowOpen ? 'Ventana de respuesta activa' : 'Se requiere una plantilla'}</p></div>
        <div className="wa-live-details-section"><small>Acciones disponibles</small><p>Mensajes, plantillas, imágenes, videos, documentos y notas de voz.</p></div>
        <div className="wa-live-details-section"><small>Regla de Meta</small><p>La escritura libre vuelve a habilitarse cuando el inquilino responde dentro de la ventana de servicio.</p></div>
      </aside>}

      {!selected && <nav className="wa-live-mobile-nav"><button type="button" className="active" onClick={returnToConversationList}><MessageCircle /><span>Chats</span></button><button type="button" onClick={() => navigate('/settings')}><Bell /><span>Novedades</span></button><button type="button" onClick={() => navigate('/settings')}><Settings2 /><span>Ajustes</span></button></nav>}
    </div>
  );
}
