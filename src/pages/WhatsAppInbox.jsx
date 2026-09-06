import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, AudioLines, Bell, Camera, CheckCheck, Download, FileText, Image, Info, Lock, MessageCircle, Mic, Paperclip, RefreshCw, Search, Send, Settings2, Smile, Square, Trash2, Video, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AUTH_TOKEN, getBase } from '../utils/config';

async function cloudRequest(path, options = {}) {
  const response = await fetch(getBase() + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'No fue posible completar la solicitud');
    error.payload = data;
    throw error;
  }
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
  const requestedTemplate = ['greeting', 'payment_reminder'].includes(searchParams.get('template')) ? searchParams.get('template') : '';
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
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
  const [templatePreview, setTemplatePreview] = useState(null);
  const [templatePreviewLoading, setTemplatePreviewLoading] = useState('');
  const [startingContactId, setStartingContactId] = useState(null);
  const [deleting, setDeleting] = useState('');
  const [windowClock, setWindowClock] = useState(Date.now());
  const [searchQuery, setSearchQuery] = useState('');
  const [listFilter, setListFilter] = useState('all');
  const [activePanel, setActivePanel] = useState(null);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [notificationPrefs, setNotificationPrefs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('whatsapp-notification-preferences') || '{}');
      return { whatsapp: saved.whatsapp !== false, scraper: saved.scraper !== false, facebook: saved.facebook !== false, sound: saved.sound === true };
    } catch { return { whatsapp: true, scraper: true, facebook: true, sound: false }; }
  });
  const fileInput = useRef(null);
  const galleryInput = useRef(null);
  const cameraPhotoInput = useRef(null);
  const cameraVideoInput = useRef(null);
  const autoPreviewKeyRef = useRef('');
  const cameraHoldTimer = useRef(null);
  const cameraHoldTriggered = useRef(false);
  const recorderRef = useRef(null);
  const recorderStreamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const discardRecordingRef = useRef(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  const scrollToBottom = useCallback((behavior = 'auto') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    } else if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const [nextStatus, nextConversations] = await Promise.all([
        cloudRequest('/whatsapp/cloud/status'),
        cloudRequest('/whatsapp/cloud/conversations'),
      ]);
      let nextContacts = [];
      try { nextContacts = await cloudRequest('/whatsapp/cloud/contacts'); } catch { /* La bandeja existente sigue funcionando aunque no cargue el directorio. */ }
      setStatus(nextStatus);
      setConversations(nextConversations);
      setContacts(nextContacts);
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
  useEffect(() => {
    loadMessages(selected);
    if (!selected) return undefined;
    const timer = setInterval(() => loadMessages(selected), 5000);
    return () => clearInterval(timer);
  }, [selected, loadMessages]);
  useEffect(() => {
    if (messages.length > 0) {
      const frame = requestAnimationFrame(() => scrollToBottom('auto'));
      return () => cancelAnimationFrame(frame);
    }
  }, [selected, messages.length, scrollToBottom]);
  useEffect(() => {
    const timer = setInterval(() => setWindowClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try { localStorage.setItem('whatsapp-notification-preferences', JSON.stringify(notificationPrefs)); } catch { /* almacenamiento local no disponible */ }
  }, [notificationPrefs]);
  useEffect(() => {
    if (!activePanel) return undefined;
    const onKeyDown = event => { if (event.key === 'Escape') setActivePanel(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePanel]);

  const selectedConversation = conversations.find(c => c.id === selected);
  const latestInbound = messages.filter(message => message.direction === 'in' && Number.isFinite(new Date(message.createdAt).getTime())).reduce((latest, message) => {
    const current = new Date(message.createdAt).getTime();
    return current > latest ? current : latest;
  }, 0);
  const inferredWindowUntil = latestInbound ? latestInbound + 24 * 60 * 60 * 1000 : 0;
  const configuredWindowUntil = selectedConversation?.customerServiceWindowUntil ? new Date(selectedConversation.customerServiceWindowUntil).getTime() : 0;
  const serverWindowUntil = selectedConversation?.windowUntil ? new Date(selectedConversation.windowUntil).getTime() : 0;
  const windowUntil = Math.max(configuredWindowUntil, serverWindowUntil, inferredWindowUntil) ? new Date(Math.max(configuredWindowUntil, serverWindowUntil, inferredWindowUntil)) : null;
  const windowOpen = Boolean(selectedConversation?.windowOpen || (windowUntil && windowUntil.getTime() > windowClock));
  const windowRemainingMs = windowOpen && windowUntil ? windowUntil.getTime() - windowClock : 0;

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
    if (message.interaction?.title || message.interaction?.displayText) return `🔘 ${message.interaction.displayText || message.interaction.title}`;
    return 'Mensaje multimedia';
  }

  function interactionStatusLabel(interaction) {
    if (!interaction) return '';
    if (interaction.status === 'handled') return `Acción ejecutada: ${interaction.detail || interaction.action}`;
    if (interaction.status === 'recorded') return `Registrado: ${interaction.detail || 'sin acción automática'}`;
    return 'Recibido; procesando acción…';
  }

  function conversationActivityTime(conversation) {
    const values = [
      conversation?.lastMessageAt,
      conversation?.lastInboundAt,
      conversation?.messages?.[0]?.createdAt,
      conversation?.createdAt,
    ].map(value => new Date(value || 0).getTime()).filter(Number.isFinite);
    return values.length ? Math.max(...values) : 0;
  }

  const orderedConversations = [...conversations].sort((left, right) => conversationActivityTime(right) - conversationActivityTime(left));
  const conversationPhones = new Set(conversations.map(conversation => String(conversation.phone || '').replace(/\D/g, '').slice(-10)).filter(Boolean));
  const contactSearchResults = searchQuery.trim()
    ? contacts.filter(contact => {
      const query = searchQuery.trim().toLocaleLowerCase();
      const haystack = [contact.name, contact.phone, contact.apartmentName, contact.apartmentId].filter(Boolean).join(' ').toLocaleLowerCase();
      const phone = String(contact.phone || '').replace(/\D/g, '').slice(-10);
      return haystack.includes(query) && !conversationPhones.has(phone);
    }).slice(0, 8)
    : [];
  const visibleConversations = orderedConversations.filter(conversation => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const haystack = [conversation.tenantName, conversation.phone, conversation.apartmentName, conversation.apartmentId].filter(Boolean).join(' ').toLocaleLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const unread = Number(conversation.unreadCount || 0) > 0;
    return matchesQuery && (listFilter !== 'unread' || unread);
  });

  function openConversation(conversationId) {
    setSelected(conversationId);
    setShowTemplates(false);
    setTemplatePreview(null);
    setError('');
    setActivePanel(null);
    setChatSearchQuery('');
    navigate(`/whatsapp?conversation=${conversationId}`);
  }

  async function startNewConversation(contact) {
    if (!contact?.tenantId || startingContactId) return;
    setStartingContactId(contact.tenantId);
    setError('');
    try {
      const result = await cloudRequest('/whatsapp/cloud/start-conversation', {
        method: 'POST',
        body: JSON.stringify({ tenantId: contact.tenantId }),
      });
      await loadConversations();
      if (result?.conversationId) openConversation(result.conversationId);
    } catch (err) { setError(err.message); }
    finally { setStartingContactId(null); }
  }

  function returnToConversationList() {
    setSelected(null);
    setShowTemplates(false);
    setTemplatePreview(null);
    setActivePanel(null);
    navigate('/whatsapp');
  }

  function openPanel(panel) {
    setShowTemplates(false);
    setTemplatePreview(null);
    setActivePanel(panel);
  }

  function toggleNotification(key) {
    setNotificationPrefs(current => ({ ...current, [key]: !current[key] }));
  }

  const visibleMessages = messages.filter(message => {
    const query = chatSearchQuery.trim().toLocaleLowerCase();
    return !query || [message.text, message.type, message.media?.fileName].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
  });

  function clearAttachment() {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    setAttachment(null);
    setAttachmentPreviewUrl('');
    if (fileInput.current) fileInput.current.value = '';
    if (galleryInput.current) galleryInput.current.value = '';
    if (cameraPhotoInput.current) cameraPhotoInput.current.value = '';
    if (cameraVideoInput.current) cameraVideoInput.current.value = '';
  }

  function handleAttachmentFile(file) {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    setAttachment(file);
    setAttachmentPreviewUrl(file && ['image', 'audio', 'video'].includes(attachmentKind(file)) ? URL.createObjectURL(file) : '');
  }

  function clearCameraHoldTimer() {
    if (cameraHoldTimer.current) clearTimeout(cameraHoldTimer.current);
    cameraHoldTimer.current = null;
  }

  function startCameraPress() {
    if (!windowOpen || sending || recording) return;
    cameraHoldTriggered.current = false;
    clearCameraHoldTimer();
    cameraHoldTimer.current = setTimeout(() => {
      cameraHoldTriggered.current = true;
      cameraVideoInput.current?.click();
    }, 520);
  }

  function finishCameraPress() {
    clearCameraHoldTimer();
    if (cameraHoldTriggered.current) {
      cameraHoldTriggered.current = false;
      return;
    }
    cameraPhotoInput.current?.click();
  }

  function cancelCameraPress() {
    clearCameraHoldTimer();
    cameraHoldTriggered.current = false;
  }

  function stopRecording({ discard = false } = {}) {
    discardRecordingRef.current = discard;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  function cancelRecording() {
    stopRecording({ discard: true });
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
      recorder.onerror = () => {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        setError('La grabación se interrumpió. Revisa el permiso del micrófono e inténtalo nuevamente.');
      };
      recorder.onstop = () => {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        stream.getTracks().forEach(track => track.stop());
        recorderStreamRef.current = null;
        setRecording(false);
        const discard = discardRecordingRef.current;
        discardRecordingRef.current = false;
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const extension = type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(recordingChunksRef.current, { type });
        if (!discard && blob.size) handleAttachmentFile(new File([blob], `nota-de-voz.${extension}`, { type }));
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
    } catch (err) {
      recorderStreamRef.current?.getTracks().forEach(track => track.stop());
      recorderStreamRef.current = null;
      setError(err.name === 'NotAllowedError' || err.name === 'SecurityError'
        ? 'Necesitas permitir el micrófono para grabar. En Android acepta el permiso de Laujim.'
        : err.message || 'No fue posible iniciar la grabación.');
    }
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

  async function loadTemplatePreview(template) {
    if (!selected || templatePreviewLoading || templateSending) return;
    setTemplatePreviewLoading(template);
    setTemplatePreview(null);
    setError('');
    try {
      const result = await cloudRequest('/whatsapp/cloud/template-preview', {
        method: 'POST', body: JSON.stringify({ conversationId: selected, template }),
      });
      setTemplatePreview(result.preview || null);
    } catch (err) {
      setTemplatePreview(err.payload?.preview || null);
      setError(err.message);
    }
    finally { setTemplatePreviewLoading(''); }
  }

  async function sendTemplate(template) {
    if (!selected || !templatePreview?.fingerprint || templatePreview.template !== template || templateSending) {
      setError('Primero prepara la vista previa de esta plantilla y confirma los datos mostrados.');
      return;
    }
    setTemplateSending(template);
    setError('');
    try {
      const result = await cloudRequest('/whatsapp/cloud/send-template', {
        method: 'POST', body: JSON.stringify({ conversationId: selected, template, period: templatePreview.period, previewFingerprint: templatePreview.fingerprint }),
      });
      if (result?.message) {
        setMessages(current => current.some(message => message.id === result.message.id) ? current : [...current, result.message]);
        setConversations(current => current.map(conversation => conversation.id === selected
          ? { ...conversation, messages: [result.message] }
          : conversation));
      }
      setShowTemplates(false);
      setTemplatePreview(null);
    } catch (err) {
      if (err.payload?.preview) setTemplatePreview(err.payload.preview);
      setError(err.message);
    }
    finally { setTemplateSending(''); }
  }

  function toggleTemplates() {
    setError('');
    setActivePanel(null);
    setShowTemplates(current => !current);
  }

  // The apartment card can open this inbox with a template request. Prepare
  // it here so every entry point follows the same preview-before-send flow.
  useEffect(() => {
    const key = requestedConversation && requestedTemplate ? `${requestedConversation}:${requestedTemplate}` : '';
    if (!key || selected !== requestedConversation || autoPreviewKeyRef.current === key || templatePreview || templatePreviewLoading) return;
    autoPreviewKeyRef.current = key;
    setShowTemplates(true);
    loadTemplatePreview(requestedTemplate);
  }, [requestedConversation, requestedTemplate, selected, templatePreview, templatePreviewLoading]);

  async function deleteMessageFromLaujim(message) {
    const confirmed = window.confirm('Este mensaje se eliminará permanentemente del historial de Laujim. Meta no puede retirarlo del WhatsApp del inquilino. ¿Continuar?');
    if (!confirmed) return;
    setDeleting(`message:${message.id}`);
    try {
      await cloudRequest(`/whatsapp/cloud/messages/${message.id}`, { method: 'DELETE' });
      setMessages(current => current.filter(item => item.id !== message.id));
      await loadConversations();
      setError('');
    } catch (err) { setError(err.message); }
    finally { setDeleting(''); }
  }

  async function deleteSelectedConversation() {
    if (!selectedConversation) return;
    const confirmed = window.confirm(`Se eliminará permanentemente de Laujim toda la conversación con ${selectedConversation.tenantName || selectedConversation.phone}. Meta no puede borrarla del WhatsApp del inquilino. ¿Continuar?`);
    if (!confirmed) return;
    const conversationId = selectedConversation.id;
    setDeleting(`conversation:${conversationId}`);
    try {
      await cloudRequest(`/whatsapp/cloud/conversations/${conversationId}`, { method: 'DELETE' });
      setConversations(current => current.filter(item => item.id !== conversationId));
      setMessages([]);
      setSelected(null);
      setShowTemplates(false);
      setActivePanel(null);
      navigate('/whatsapp');
      setError('');
    } catch (err) { setError(err.message); }
    finally { setDeleting(''); }
  }

  return (
    <div className={`wa-live-shell ${selected ? 'wa-live-selected' : ''}`}>
      <aside className="wa-live-sidebar">
        <div className="wa-live-list-top">
          <h1><MessageCircle className="w-6 h-6" /> WhatsApp</h1>
          <div className="wa-live-top-actions">
            <button type="button" onClick={loadConversations} className="wa-live-icon" title="Actualizar conversaciones" aria-label="Actualizar conversaciones"><RefreshCw className="w-4 h-4" /></button>
            <button type="button" onClick={() => openPanel('settings')} className="wa-live-icon" title="Ajustes de WhatsApp" aria-label="Ajustes de WhatsApp"><Settings2 className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="wa-live-search"><Search className="w-4 h-4" /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Buscar contactos o apartamentos" aria-label="Buscar contactos o apartamentos" /></div>
        <div className="wa-live-tabs">
          <button type="button" onClick={() => setListFilter('all')} className={listFilter === 'all' ? 'active' : ''}>Todos</button>
          <button type="button" onClick={() => setListFilter('unread')} className={listFilter === 'unread' ? 'active' : ''}>No leídos</button>
        </div>
        <button type="button" className="wa-live-archived" onClick={() => openPanel('archived')} title="Ver chats archivados"><Archive className="w-5 h-5" /><strong>Archivados</strong><span>›</span></button>
        <div className="wa-live-api-status">
          <span className={status?.ready ? 'online' : 'offline'} />
          {status?.ready ? 'Cloud API conectada' : 'Cloud API requiere configuración'}
        </div>
        {error && <div className="wa-live-error">{error}</div>}
        <div className="wa-live-conversation-list">
          {loading ? <p className="wa-live-empty">Cargando conversaciones…</p> : <>
            {contactSearchResults.length > 0 && <div className="wa-live-new-contacts">
              <div className="wa-live-section-label">Nuevas conversaciones</div>
              {contactSearchResults.map(contact => <div key={contact.tenantId} className="wa-live-new-contact">
                <span className="wa-live-avatar">{String(contact.apartmentName || contact.apartmentId || '—').replace(/\D/g, '').slice(0, 4) || '·'}</span>
                <span className="wa-live-row-main"><strong>{contact.name || 'Inquilino'}</strong><small>{contact.phone}{contact.apartmentName ? ` · Apto. ${contact.apartmentName}` : ' · Sin apartamento'}</small></span>
                <button type="button" onClick={() => startNewConversation(contact)} disabled={startingContactId === contact.tenantId} className="wa-live-new-contact-action" title="Iniciar conversación">
                  <Send className="w-3.5 h-3.5" /> {startingContactId === contact.tenantId ? 'Abriendo…' : 'Iniciar'}
                </button>
              </div>)}
            </div>}
            {!visibleConversations.length ? <p className="wa-live-empty">{contactSearchResults.length ? 'Selecciona un inquilino para iniciar el chat.' : listFilter === 'unread' ? 'No hay conversaciones sin leer.' : conversations.length ? 'No hay coincidencias.' : 'Aún no hay mensajes autorizados.'}</p> : visibleConversations.map(conversation => {
            const latestConversationInbound = conversation.lastInboundAt ? new Date(conversation.lastInboundAt).getTime() : 0;
            const conversationWindowUntil = conversation.customerServiceWindowUntil ? new Date(conversation.customerServiceWindowUntil).getTime() : 0;
            const conversationWindowOpen = Boolean(conversation.windowOpen || Math.max(conversationWindowUntil, latestConversationInbound + 24 * 60 * 60 * 1000) > Date.now());
            return <button key={conversation.id} type="button" onClick={() => openConversation(conversation.id)} className={`wa-live-row ${selected === conversation.id ? 'selected' : ''}`}>
              <span className="wa-live-avatar">{apartmentBadge(conversation)}</span>
              <span className="wa-live-row-main">
                <span className="wa-live-row-head"><strong>{conversation.tenantName || 'Inquilino autorizado'}</strong><time>{listTime(conversation.lastInboundAt || conversation.messages?.[0]?.createdAt)}</time></span>
                <span className="wa-live-row-preview">{previewText(conversation)}</span>
                <span className={`wa-live-row-status ${conversationWindowOpen ? 'open' : 'closed'}`}>{conversationWindowOpen ? 'Ventana activa' : 'Requiere plantilla'} · Apto. {conversation.apartmentName || conversation.apartmentId || '—'}</span>
              </span>
            </button>;
            })}
          </>}
        </div>
        <div className="wa-live-sidebar-note"><button type="button" onClick={() => navigate('/dashboard')} className="wa-live-sidebar-exit" title="Salir de WhatsApp y volver al dashboard"><X className="w-3.5 h-3.5" /> Salir</button><span>Canal oficial · solo conversaciones de residentes autorizados</span></div>
      </aside>

      <section className="wa-live-chat">
        {!selectedConversation ? <div className="wa-live-empty-chat"><Lock className="w-10 h-10" /><strong>Selecciona una conversación</strong><span>Busca un inquilino o apartamento para comenzar.</span></div> : <>
          <div className="wa-live-chat-head">
            <button type="button" onClick={returnToConversationList} className="wa-live-icon wa-live-mobile-only" aria-label="Volver a conversaciones"><ArrowLeft className="w-5 h-5" /></button>
            <span className="wa-live-avatar large">{apartmentBadge(selectedConversation)}</span>
            <div className="wa-live-chat-person"><strong>{selectedConversation.tenantName || 'Inquilino autorizado'}</strong><span>{selectedConversation.phone} · Apartamento {selectedConversation.apartmentName || selectedConversation.apartmentId || '—'}</span></div>
            <div className="wa-live-chat-actions">
              <button type="button" onClick={() => openPanel('chat-search')} className="wa-live-icon" title="Buscar en esta conversación" aria-label="Buscar en esta conversación"><Search className="w-4 h-4" /></button>
              <button type="button" onClick={() => openPanel('info')} className="wa-live-icon" title="Información del contacto" aria-label="Información del contacto"><Info className="w-4 h-4" /></button>
              <button type="button" onClick={toggleTemplates} className={`wa-live-icon ${!windowOpen ? 'danger' : ''}`} title={!windowOpen ? 'La ventana de Meta está cerrada: elegir plantilla' : 'Enviar plantilla'} aria-label={!windowOpen ? 'Elegir plantilla' : 'Enviar plantilla'}><FileText className="w-4 h-4" /></button>
              <button type="button" onClick={deleteSelectedConversation} disabled={deleting === `conversation:${selectedConversation.id}`} className="wa-live-icon danger" title="Eliminar conversación de Laujim" aria-label="Eliminar conversación de Laujim"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="wa-live-chat-state"><span className={windowOpen ? 'open' : 'closed'} />{windowRemainingLabel()}</div>
          {showTemplates && <div className="wa-live-template-panel">
            <div><strong>Plantillas aprobadas por Meta</strong><span>Primero revisa los datos guardados por el último scraper; el mensaje no se enviará hasta que lo confirmes.</span></div>
            <div className="wa-live-template-actions">
              <button type="button" disabled={!!templateSending || !!templatePreviewLoading} onClick={() => loadTemplatePreview('greeting')}>{templatePreviewLoading === 'greeting' ? 'Preparando…' : 'Hola, ¿cómo estás?'}</button>
              <button type="button" disabled={!!templateSending || !!templatePreviewLoading} onClick={() => loadTemplatePreview('payment_reminder')}>{templatePreviewLoading === 'payment_reminder' ? 'Preparando…' : 'Cobro + servicios'}</button>
            </div>
            {error && <div className="wa-live-template-error" role="alert">{error}</div>}
            {templatePreview && <div className="wa-live-template-preview">
              <div className="wa-live-template-preview-head"><div><strong>Vista previa · {templatePreview.templateName}</strong><span>Últimos datos guardados · {formatDate(templatePreview.generatedAt)}</span></div><button type="button" onClick={() => setTemplatePreview(null)} className="wa-live-icon" aria-label="Cerrar vista previa"><X className="w-4 h-4" /></button></div>
              {templatePreview.warning && <div className="wa-live-template-error" role="status">{templatePreview.warning}</div>}
              <pre>{templatePreview.previewText}</pre>
              {templatePreview.dataSync && <div className="wa-live-template-sync"><span>Última sincronización usada:</span><span>⚡ {templatePreview.dataSync.air ? formatDate(templatePreview.dataSync.air) : 'sin dato'}</span><span>💧 {templatePreview.dataSync.water ? formatDate(templatePreview.dataSync.water) : 'sin dato'}</span><span>🔥 {templatePreview.dataSync.gas ? formatDate(templatePreview.dataSync.gas) : 'sin dato'}</span></div>}
              <div className="wa-live-template-confirm"><span>{templatePreview.canSend === false ? 'Corrige la asociación antes de enviar.' : '¿Enviar exactamente esta plantilla?'}</span><button type="button" disabled={!!templateSending || templatePreview.canSend === false} onClick={() => sendTemplate(templatePreview.template)}>{templateSending === templatePreview.template ? 'Enviando…' : 'Enviar ahora'}</button><button type="button" disabled={!!templateSending} onClick={() => setTemplatePreview(null)}>Cancelar</button></div>
            </div>}
          </div>}
          <div ref={messagesContainerRef} className="wa-live-messages">
            {messages.length === 0 ? <p className="wa-live-empty">Aún no hay mensajes.</p> : !visibleMessages.length ? <p className="wa-live-empty">No hay mensajes que coincidan con la búsqueda.</p> : visibleMessages.map(message => (
              <div key={message.id} className={`wa-live-bubble ${message.direction === 'out' ? 'out' : 'in'}`}>
                <button type="button" onClick={() => deleteMessageFromLaujim(message)} disabled={deleting === `message:${message.id}`} className="wa-live-bubble-delete" title="Eliminar de Laujim" aria-label="Eliminar mensaje de Laujim"><Trash2 className="w-3.5 h-3.5" /></button>
                {message.text && <p>{message.text}</p>}
                {message.interaction && <div className="wa-live-interaction-card"><strong>🔘 Respuesta: {message.interaction.displayText || message.interaction.title || (message.interaction.id || message.interaction.payload ? `Botón ${message.interaction.id || message.interaction.payload}` : 'botón sin título')}</strong><small>{message.interaction.id ? `ID: ${message.interaction.id} · ` : message.interaction.payload ? `Payload: ${message.interaction.payload} · ` : ''}{interactionStatusLabel(message.interaction)}</small></div>}
                {!message.text && !message.mediaId && <p>{message.type === 'text' ? 'Mensaje sin texto' : `Mensaje ${message.type || ''}`}</p>}
                <MediaMessage message={message} />
                <div className="wa-live-bubble-meta">{formatDate(message.createdAt)} {message.direction === 'out' && <CheckCheck className="w-3.5 h-3.5" />}</div>
              </div>
            ))}
            <div ref={messagesEndRef} style={{ float: 'left', clear: 'both', height: '1px' }} />
          </div>
          <form onSubmit={sendMessage} className="wa-live-compose-wrap">
            <div className={`wa-live-compose-status ${windowOpen ? 'open' : 'closed'}`}><span>{windowOpen ? 'Puedes responder libremente' : 'La ventana está cerrada'}</span><small>{windowOpen ? 'Mensajes, fotos, videos y notas de voz' : 'El botón rojo abre las plantillas'}</small></div>
            {recording && <div className="wa-live-recording-banner" role="status" aria-live="polite">
              <span className="wa-live-recording-pulse" />
              <div className="wa-live-recording-copy"><strong>Grabando nota de voz</strong><small>Habla ahora · toca Listo para detener</small></div>
              <strong className="wa-live-recording-time">{String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</strong>
              <button type="button" onClick={cancelRecording} className="wa-live-recording-cancel">Cancelar</button>
              <button type="button" onClick={() => stopRecording()} className="wa-live-recording-stop"><Square className="w-3.5 h-3.5" /> Listo</button>
            </div>}
            {attachment && <div className="wa-live-attachment">
              <div className="wa-live-attachment-head"><span><MediaIcon type={attachmentKind(attachment)} className="w-4 h-4" />{attachment.name} · {(attachment.size / (1024 * 1024)).toFixed(1)} MB</span><button type="button" onClick={clearAttachment} aria-label="Quitar archivo"><X className="w-4 h-4" /></button></div>
              {attachmentPreviewUrl && attachmentKind(attachment) === 'image' && <img src={attachmentPreviewUrl} alt="Vista previa del archivo" />}
              {attachmentPreviewUrl && attachmentKind(attachment) === 'video' && <video src={attachmentPreviewUrl} controls />}
              {attachmentPreviewUrl && attachmentKind(attachment) === 'audio' && <audio src={attachmentPreviewUrl} controls />}
            </div>}
            <div className="wa-live-compose">
              <button type="button" onClick={() => navigate('/dashboard')} title="Salir de WhatsApp y volver al dashboard" aria-label="Salir de WhatsApp y volver al dashboard" className="wa-live-control wa-live-exit"><X className="w-4 h-4" /></button>
              {recording ? <button type="button" onClick={() => stopRecording()} title="Detener grabación" className="wa-live-control recording"><Square className="w-4 h-4" /><span>Detener</span></button> : <button type="button" onClick={startRecording} disabled={!windowOpen || sending} title="Grabar nota de voz" className="wa-live-control"><Mic className="w-4 h-4" /></button>}
              <input ref={fileInput} type="file" className="hidden" accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={event => handleAttachmentFile(event.target.files?.[0] || null)} />
              <input ref={galleryInput} type="file" className="hidden" accept="image/*,video/*" onChange={event => handleAttachmentFile(event.target.files?.[0] || null)} />
              <input ref={cameraPhotoInput} type="file" className="hidden" accept="image/*" capture="environment" onChange={event => handleAttachmentFile(event.target.files?.[0] || null)} />
              <input ref={cameraVideoInput} type="file" className="hidden" accept="video/*" capture="environment" onChange={event => handleAttachmentFile(event.target.files?.[0] || null)} />
              <button type="button" onClick={event => { if (event.detail === 0) cameraPhotoInput.current?.click(); }} onPointerDown={startCameraPress} onPointerUp={finishCameraPress} onPointerCancel={cancelCameraPress} onPointerLeave={cancelCameraPress} disabled={!windowOpen || sending || recording} title="Toca para tomar una foto · mantén presionado para grabar video" aria-label="Tomar foto o grabar video" className="wa-live-control"><Camera className="w-4 h-4" /></button>
              <button type="button" onClick={() => galleryInput.current?.click()} disabled={!windowOpen || sending || recording} title="Elegir foto o video de la galería" aria-label="Elegir foto o video de la galería" className="wa-live-control"><Image className="w-4 h-4" /></button>
              <button type="button" onClick={() => fileInput.current?.click()} disabled={!windowOpen || sending || recording} title="Adjuntar imagen, audio, video o documento (máx. 16 MB)" className="wa-live-control"><Paperclip className="w-4 h-4" /></button>
              <button type="button" onClick={() => setDraft(current => `${current}😊`)} disabled={!windowOpen || sending || recording} title="Añadir emoji" className="wa-live-control wa-live-optional"><Smile className="w-4 h-4" /></button>
              <input value={draft} onChange={event => setDraft(event.target.value)} disabled={!windowOpen || sending || recording} placeholder={recording ? 'Grabando nota de voz…' : windowOpen ? attachment ? 'Añade un texto opcional…' : 'Escribe un mensaje' : 'Escritura bloqueada hasta que respondan'} />
              <button type={windowOpen ? 'submit' : 'button'} onClick={() => { if (!windowOpen) { setError(''); setShowTemplates(true); } }} disabled={windowOpen ? (recording || (!draft.trim() && !attachment) || sending) : !!templateSending} title={windowOpen ? (attachment ? 'Enviar archivo' : 'Enviar mensaje') : 'La ventana de Meta está cerrada: elegir plantilla'} aria-label={windowOpen ? 'Enviar mensaje' : 'Elegir plantilla'} className={`wa-live-send ${windowOpen ? 'open' : 'closed'}`}>
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

      {!selected && <nav className="wa-live-mobile-nav"><button type="button" className="wa-live-mobile-exit" onClick={() => navigate('/dashboard')} title="Salir de WhatsApp y volver al dashboard"><X /><span>Salir</span></button><button type="button" className={!activePanel ? 'active' : ''} onClick={returnToConversationList}><MessageCircle /><span>Chats</span></button><button type="button" className={activePanel === 'notifications' ? 'active' : ''} onClick={() => openPanel('notifications')}><Bell /><span>Novedades</span></button><button type="button" className={activePanel === 'settings' ? 'active' : ''} onClick={() => openPanel('settings')}><Settings2 /><span>Ajustes</span></button></nav>}

      {activePanel && <div className="wa-live-panel-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setActivePanel(null); }}>
        <section className="wa-live-panel" role="dialog" aria-modal="true" aria-labelledby="wa-live-panel-title">
          <div className="wa-live-panel-head"><div><small>WhatsApp de Laujim</small><h2 id="wa-live-panel-title">{activePanel === 'settings' ? 'Ajustes' : activePanel === 'notifications' ? 'Novedades y notificaciones' : activePanel === 'archived' ? 'Chats archivados' : activePanel === 'chat-search' ? 'Buscar en la conversación' : 'Información del contacto'}</h2></div><button type="button" onClick={() => setActivePanel(null)} className="wa-live-icon" aria-label="Cerrar panel"><X className="w-5 h-5" /></button></div>

          {activePanel === 'settings' && <div className="wa-live-panel-body">
            <p className="wa-live-panel-copy">Configura las alertas de este canal sin salir de la bandeja de WhatsApp.</p>
            {[['whatsapp', 'Mensajes de WhatsApp', 'Avisos de mensajes nuevos y respuestas rápidas.'], ['scraper', 'Scraper de servicios', 'Resultados y errores de Air-e, Triple A y Gases.'], ['facebook', 'Facebook Marketplace', 'Publicaciones, fotos y errores del worker.'], ['sound', 'Sonido', 'Reproducir sonido cuando llegue una alerta.']].map(([key, title, description]) => <label key={key} className="wa-live-setting-row"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={notificationPrefs[key]} onChange={() => toggleNotification(key)} /><i /></label>)}
            <div className="wa-live-panel-actions"><button type="button" onClick={() => { loadConversations(); setActivePanel(null); }} className="wa-live-panel-primary"><RefreshCw className="w-4 h-4" /> Actualizar bandeja</button><button type="button" onClick={() => setActivePanel(null)} className="wa-live-panel-secondary">Cerrar</button></div>
          </div>}

          {activePanel === 'notifications' && <div className="wa-live-panel-body">
            <div className="wa-live-notice-card"><span className="online" /><div><strong>Conexión del canal</strong><p>{status?.ready ? 'Cloud API conectada y lista para recibir mensajes.' : 'La Cloud API requiere configuración o no está disponible.'}</p></div></div>
            <div className="wa-live-notice-card"><Bell className="w-5 h-5" /><div><strong>Alertas activas</strong><p>{Object.values(notificationPrefs).filter(Boolean).length} de 4 preferencias habilitadas en este dispositivo.</p></div></div>
            <div className="wa-live-notice-card"><MessageCircle className="w-5 h-5" /><div><strong>Conversaciones</strong><p>{conversations.length ? `${conversations.length} conversación(es) cargada(s).` : 'No hay conversaciones cargadas.'} {conversations.filter(item => Number(item.unreadCount || 0) > 0).length ? 'Hay mensajes sin leer.' : 'No hay mensajes sin leer.'}</p></div></div>
            <div className="wa-live-panel-actions"><button type="button" onClick={() => openPanel('settings')} className="wa-live-panel-primary"><Settings2 className="w-4 h-4" /> Configurar alertas</button></div>
          </div>}

          {activePanel === 'archived' && <div className="wa-live-panel-body"><div className="wa-live-notice-card"><Archive className="w-5 h-5" /><div><strong>No hay chats archivados</strong><p>Las conversaciones archivadas aparecerán aquí cuando se conecte el historial correspondiente.</p></div></div><div className="wa-live-panel-actions"><button type="button" onClick={() => { setListFilter('all'); setActivePanel(null); }} className="wa-live-panel-primary">Volver a todos los chats</button></div></div>}

          {activePanel === 'chat-search' && <div className="wa-live-panel-body"><label className="wa-live-panel-search"><Search className="w-4 h-4" /><input autoFocus value={chatSearchQuery} onChange={event => setChatSearchQuery(event.target.value)} placeholder="Buscar texto, archivo o tipo de mensaje" /></label><p className="wa-live-panel-copy">{chatSearchQuery ? `${visibleMessages.length} resultado(s) en esta conversación.` : 'Escribe para filtrar los mensajes visibles.'}</p><div className="wa-live-panel-actions"><button type="button" onClick={() => setActivePanel(null)} className="wa-live-panel-primary">Ver resultados</button><button type="button" onClick={() => { setChatSearchQuery(''); setActivePanel(null); }} className="wa-live-panel-secondary">Limpiar</button></div></div>}

           {activePanel === 'info' && <div className="wa-live-panel-body"><div className="wa-live-panel-profile"><span className="wa-live-avatar xl">{apartmentBadge(selectedConversation)}</span><strong>{selectedConversation?.tenantName || 'Inquilino autorizado'}</strong><span>{selectedConversation?.phone || 'Teléfono no disponible'}</span><span>Apartamento {selectedConversation?.apartmentName || selectedConversation?.apartmentId || '—'}</span></div><div className="wa-live-notice-card"><Info className="w-5 h-5" /><div><strong>Estado de la conversación</strong><p>{windowOpen ? windowRemainingLabel() : 'Ventana cerrada: usa una plantilla aprobada.'}</p></div></div><div className="wa-live-notice-card"><Trash2 className="w-5 h-5" /><div><strong>Borrado</strong><p>Puedes eliminar mensajes o toda esta conversación del historial de Laujim. Meta no ofrece borrado para ambos.</p></div></div><div className="wa-live-panel-actions"><button type="button" onClick={() => setActivePanel(null)} className="wa-live-panel-primary">Volver al chat</button></div></div>}
        </section>
      </div>}
    </div>
  );
}
