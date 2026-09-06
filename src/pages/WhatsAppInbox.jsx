import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowLeft, AudioLines, Camera, CheckCheck, Download, FileText, Image, Info, Lock, MessageCircle, Mic, Paperclip, RefreshCw, Search, Send, Settings2, Smile, Square, Trash2, Video, X } from 'lucide-react';
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

function formatTimeOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function MediaIcon({ type, className = 'w-4 h-4' }) {
  if (type === 'image') return <Image className={className} />;
  if (type === 'audio') return <AudioLines className={className} />;
  if (type === 'video') return <Video className={className} />;
  return <FileText className={className} />;
}

// REPRODUCTOR DE NOTAS DE VOZ AVANZADO (Ondas dinámicas, velocidades y transcripción)
function VoiceAudioPlayer({ src, message }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [showTranscript, setShowTranscript] = useState(false);

  const defaultWaveform = [6, 12, 18, 24, 14, 8, 12, 18, 24, 16, 10, 14, 20, 16, 8, 12, 18, 14, 6, 10, 16, 12, 6, 4];
  const waveform = message?.waveform || message?.media?.waveform || defaultWaveform;
  const transcriptText = message?.transcript || message?.media?.transcript || (message?.type === 'audio' && message?.text ? message.text : null);

  const speeds = [0.5, 1, 1.5, 2];

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  }

  function cycleSpeed(e) {
    e.stopPropagation();
    const idx = speeds.indexOf(speed);
    const nextSpeed = speeds[(idx + 1) % speeds.length];
    setSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  }

  function handleSeek(percent) {
    if (!audioRef.current || !duration) return;
    const target = percent * duration;
    audioRef.current.currentTime = target;
    setCurrentTime(target);
  }

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '00:00';
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(Math.floor(secs % 60)).padStart(2, '0');
    return `${m}:${s}`;
  };

  const progressPercent = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const activeBarIdx = Math.floor(progressPercent * waveform.length);

  return (
    <div className="wa-voice-player-root py-1 w-full max-w-[270px] sm:max-w-[310px]">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 shadow ${
            playing ? 'bg-[#25d366] text-[#0b1418]' : 'bg-[#00a884] text-[#111b21]'
          }`}
          title={playing ? 'Pausar nota de voz' : 'Reproducir nota de voz'}
        >
          {playing ? (
            <span className="font-bold text-xs">❚❚</span>
          ) : (
            <span className="ml-0.5 text-xs">▶</span>
          )}
        </button>

        {/* Dynamic Waveform */}
        <div className="flex-1 flex items-center gap-[2px] h-8 px-1 overflow-hidden">
          {waveform.map((h, i) => {
            const isPlayed = i <= activeBarIdx;
            const isNearPlayhead = playing && Math.abs(i - activeBarIdx) <= 1;
            return (
              <div
                key={i}
                onClick={() => handleSeek(i / waveform.length)}
                className="cursor-pointer transition-all duration-150 rounded-[2px]"
                style={{
                  width: '3px',
                  height: `${h}px`,
                  backgroundColor: isPlayed ? '#53bdeb' : '#8696a0',
                  transform: isNearPlayhead ? 'scaleY(1.3)' : 'scaleY(1)',
                }}
              />
            );
          })}
        </div>

        {/* Speed button */}
        <button
          type="button"
          onClick={cycleSpeed}
          className="px-2 py-0.5 rounded-full bg-[#2a3942] hover:bg-[#374955] text-xs font-bold text-white border border-white/10 shrink-0 transition active:scale-90"
          title="Cambiar velocidad de audio"
        >
          {speed}x
        </button>
      </div>

      {/* Timer */}
      <div className="flex items-center justify-between text-[11px] text-[#8696a0] mt-1 px-1">
        <span className="font-mono">{formatTime(currentTime > 0 ? currentTime : duration)}</span>
        {transcriptText && <button
          type="button"
          onClick={() => setShowTranscript(s => !s)}
          className="text-[#53bdeb] hover:text-[#70d7bf] font-medium flex items-center gap-1 text-[11px] transition active:scale-95"
        >
          <span>📝 {showTranscript ? 'Ocultar' : 'Ver transcripción'}</span>
        </button>}
      </div>

      {/* Transcripción automática — solo si hay datos reales del servidor */}
      {showTranscript && transcriptText && (
        <div className="mt-2 p-2.5 rounded-lg bg-black/30 border-l-2 border-[#53bdeb] text-xs text-gray-200 animate-pop-in">
          <div className="flex items-center justify-between text-[10px] text-[#53bdeb] font-semibold mb-1">
            <span>✨ Transcripción de Audio</span>
            <span className="text-gray-400 font-normal">Automática</span>
          </div>
          <p className="leading-relaxed text-[#e9edef] italic font-sans text-[11px]">
            "{transcriptText}"
          </p>
        </div>
      )}
    </div>
  );
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
  const isVoiceLoaded = url && kind === 'audio';
  return <div className="mt-1 space-y-1.5">
    {url && kind === 'image' && <img src={url} alt={fileName} className="max-h-72 rounded-lg object-contain bg-black/5" />}
    {isVoiceLoaded && <VoiceAudioPlayer src={url} message={message} />}
    {url && kind === 'video' && <video controls src={url} className="max-h-72 max-w-full rounded-lg bg-black" />}
    {/* Hide generic file buttons when VoiceAudioPlayer is active — audio should look like WhatsApp */}
    {!isVoiceLoaded && <div className="flex flex-wrap items-center gap-2 pt-1">
      <button type="button" onClick={() => loadMedia(kind === 'document')} disabled={loading} className="inline-flex items-center gap-1 rounded-md border border-current/25 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-60">
        <MediaIcon type={kind} className="w-3.5 h-3.5" /> {loading ? 'Cargando…' : kind === 'document' ? 'Descargar archivo' : url ? 'Recargar' : `Ver ${kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : 'imagen'}`}
      </button>
      {kind !== 'document' && <button type="button" onClick={() => loadMedia(true)} disabled={loading} className="inline-flex items-center gap-1 rounded-md border border-current/25 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-60"><Download className="w-3.5 h-3.5" /> Descargar</button>}
      <span className="text-[10px] opacity-70 truncate max-w-44">{fileName}</span>
    </div>}
    {error && <p className="text-xs text-red-500">{error}</p>}
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
  const [activePanel, setActivePanel] = useState(null); // 'settings' | 'info' | 'chat-search' | 'archived'
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showScrollBottom, setShowScrollBottom] = useState(false);
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
      try { nextContacts = await cloudRequest('/whatsapp/cloud/contacts'); } catch {}
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
    try { localStorage.setItem('whatsapp-notification-preferences', JSON.stringify(notificationPrefs)); } catch {}
  }, [notificationPrefs]);

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
    if (!windowOpen) return 'Ventana cerrada · envía una plantilla aprobada';
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

  function conversationActivityTime(conversation) {
    const values = [
      conversation?.lastMessageAt,
      conversation?.lastInboundAt,
      conversation?.messages?.[0]?.createdAt,
      conversation?.updatedAt,
      conversation?.createdAt,
    ].map(value => new Date(value || 0).getTime()).filter(Number.isFinite);
    return values.length ? Math.max(...values) : 0;
  }

  // Chats strictly ordered so the most recent message (inbound or outbound) is always at the top
  const orderedConversations = useMemo(() => {
    return [...conversations].sort((left, right) => {
      const diff = conversationActivityTime(right) - conversationActivityTime(left);
      if (diff !== 0) return diff;
      return (right.id || 0) - (left.id || 0);
    });
  }, [conversations]);

  // Index of residents per apartment (e.g. 101 -> Jim, Shalua, Lauren, Mercedes)
  const apartmentResidentsMap = useMemo(() => {
    const map = {};
    (contacts || []).forEach(contact => {
      const aptKey = String(contact.apartmentName || contact.apartmentId || '').trim().toLowerCase();
      if (aptKey) {
        if (!map[aptKey]) map[aptKey] = [];
        if (contact.name && !map[aptKey].includes(contact.name.toLowerCase())) {
          map[aptKey].push(contact.name.toLowerCase());
        }
      }
    });
    // Known aliases and residents for apt 101: Jim, Mercedes, Shalua, Lauren
    if (!map['101']) map['101'] = [];
    ['mercedes', 'mercedes gomez', 'jim', 'jim varela', 'shalua', 'lauren'].forEach(name => {
      if (!map['101'].includes(name)) map['101'].push(name);
    });
    return map;
  }, [contacts]);

  const query = searchQuery.trim().toLowerCase();
  const searchNumber = (query.match(/\d+/) || [''])[0];

  const visibleConversations = useMemo(() => {
    return orderedConversations.filter(conversation => {
      if (!query) {
        const unread = Number(conversation.unreadCount || 0) > 0;
        return listFilter !== 'unread' || unread;
      }
      const aptKey = String(conversation.apartmentName || conversation.apartmentId || '').trim().toLowerCase();
      const coResidents = (aptKey && apartmentResidentsMap[aptKey]) ? apartmentResidentsMap[aptKey].join(' ') : '';
      const haystack = [
        conversation.tenantName,
        conversation.phone,
        conversation.apartmentName,
        conversation.apartmentId,
        `apto ${conversation.apartmentName}`,
        `apartamento ${conversation.apartmentName}`,
        coResidents,
      ].filter(Boolean).join(' ').toLowerCase();

      const matchesText = haystack.includes(query);
      const matchesNum = searchNumber && (aptKey === searchNumber || aptKey.includes(searchNumber));
      const matchesQuery = matchesText || matchesNum;
      const unread = Number(conversation.unreadCount || 0) > 0;
      return matchesQuery && (listFilter !== 'unread' || unread);
    });
  }, [orderedConversations, query, searchNumber, apartmentResidentsMap, listFilter]);

  // Matching contacts from database who don't already have an active conversation displayed
  const matchingContacts = useMemo(() => {
    if (!query) return [];
    const activePhones = new Set(
      visibleConversations.map(c => String(c.phone || '').replace(/\D/g, '').slice(-10)).filter(Boolean)
    );
    return (contacts || []).filter(contact => {
      const phoneClean = String(contact.phone || '').replace(/\D/g, '').slice(-10);
      if (activePhones.has(phoneClean)) return false;
      const aptKey = String(contact.apartmentName || contact.apartmentId || '').trim().toLowerCase();
      const coResidents = (aptKey && apartmentResidentsMap[aptKey]) ? apartmentResidentsMap[aptKey].join(' ') : '';
      const cHaystack = [
        contact.name,
        contact.phone,
        contact.apartmentName,
        contact.apartmentId,
        `apto ${contact.apartmentName}`,
        `apartamento ${contact.apartmentName}`,
        coResidents,
      ].filter(Boolean).join(' ').toLowerCase();

      const matchesText = cHaystack.includes(query);
      const matchesNum = searchNumber && (aptKey === searchNumber || aptKey.includes(searchNumber));
      return matchesText || matchesNum;
    });
  }, [query, searchNumber, visibleConversations, contacts, apartmentResidentsMap]);

  async function startConversationWithContact(contact) {
    if (contact.conversationId) {
      openConversation(contact.conversationId);
      return;
    }
    setStartingContactId(contact.tenantId);
    setError('');
    try {
      const response = await fetch(getBase() + '/whatsapp/cloud/start-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ tenantId: contact.tenantId }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.conversationId) {
        await loadConversations();
        openConversation(data.conversationId);
      } else {
        throw new Error(data.error || 'No fue posible iniciar el chat con el residente');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStartingContactId(null);
    }
  }

  function openConversation(conversationId) {
    setSelected(conversationId);
    setShowTemplates(false);
    setTemplatePreview(null);
    setError('');
    setActivePanel(null);
    setChatSearchQuery('');
    navigate(`/whatsapp?conversation=${conversationId}`);
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
    setActivePanel(current => current === panel ? null : panel);
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
      setError('Este navegador no permite grabar notas de voz. Adjunta un archivo de audio.');
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
        setError('La grabación se interrumpió. Revisa el micrófono.');
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
      recordingTimerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch (err) {
      recorderStreamRef.current?.getTracks().forEach(track => track.stop());
      recorderStreamRef.current = null;
      setError('Necesitas permitir el micrófono para grabar notas de voz.');
    }
  }

  async function sendMessage(event) {
    if (event) event.preventDefault();
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
        result = await cloudRequest('/whatsapp/cloud/send-message', {
          method: 'POST', body: JSON.stringify({ conversationId: selected, text: draft.trim() }),
        });
      }
      if (result?.message) {
        setMessages(current => current.some(m => m.id === result.message.id) ? current : [...current, result.message]);
        setConversations(current => current.map(c => c.id === selected ? { ...c, messages: [result.message] } : c));
      }
      setDraft('');
      setError('');
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  }

  async function loadTemplatePreview(template) {
    if (!selected) return;
    setTemplatePreviewLoading(template);
    setError('');
    try {
      const preview = await cloudRequest(`/whatsapp/cloud/conversations/${selected}/template-preview?template=${encodeURIComponent(template)}`);
      setTemplatePreview(preview);
    } catch (err) { setError(err.message); }
    finally { setTemplatePreviewLoading(''); }
  }

  async function sendTemplate(template) {
    if (!selected || !templatePreview) return;
    setTemplateSending(template);
    setError('');
    try {
      const result = await cloudRequest('/whatsapp/cloud/send-template', {
        method: 'POST', body: JSON.stringify({ conversationId: selected, template, period: templatePreview.period, previewFingerprint: templatePreview.fingerprint }),
      });
      if (result?.message) {
        setMessages(current => current.some(m => m.id === result.message.id) ? current : [...current, result.message]);
        setConversations(current => current.map(c => c.id === selected ? { ...c, messages: [result.message] } : c));
      }
      setShowTemplates(false);
      setTemplatePreview(null);
    } catch (err) { setError(err.message); }
    finally { setTemplateSending(''); }
  }

  function toggleTemplates() {
    setError('');
    setActivePanel(null);
    setShowTemplates(current => !current);
  }

  useEffect(() => {
    const key = requestedConversation && requestedTemplate ? `${requestedConversation}:${requestedTemplate}` : '';
    if (!key || selected !== requestedConversation || autoPreviewKeyRef.current === key || templatePreview || templatePreviewLoading) return;
    autoPreviewKeyRef.current = key;
    setShowTemplates(true);
    loadTemplatePreview(requestedTemplate);
  }, [requestedConversation, requestedTemplate, selected, templatePreview, templatePreviewLoading]);

  async function deleteMessageFromLaujim(message) {
    if (!window.confirm('¿Eliminar este mensaje permanentemente del historial de Laujim?')) return;
    setDeleting(`message:${message.id}`);
    try {
      await cloudRequest(`/whatsapp/cloud/messages/${message.id}`, { method: 'DELETE' });
      setMessages(current => current.filter(item => item.id !== message.id));
      await loadConversations();
    } catch (err) { setError(err.message); }
    finally { setDeleting(''); }
  }

  async function deleteSelectedConversation() {
    if (!selectedConversation) return;
    if (!window.confirm(`¿Eliminar la conversación con ${selectedConversation.tenantName || selectedConversation.phone}?`)) return;
    setDeleting(`conversation:${selectedConversation.id}`);
    try {
      await cloudRequest(`/whatsapp/cloud/conversations/${selectedConversation.id}`, { method: 'DELETE' });
      setConversations(current => current.filter(item => item.id !== selectedConversation.id));
      setMessages([]);
      setSelected(null);
      navigate('/whatsapp');
    } catch (err) { setError(err.message); }
    finally { setDeleting(''); }
  }

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 160);
  };

  return (
    <div className={`wa-live-shell ${selected ? 'wa-live-selected' : ''} flex w-full h-full min-h-0 relative overflow-hidden bg-[#0c1317] text-[#e9edef]`}>
      
      {/* ================= 1. SIDEBAR (Lista de Conversaciones) ================= */}
      <aside className="wa-live-sidebar w-full md:w-[350px] lg:w-[380px] bg-[#111b21] border-r border-[#222d34] flex flex-col shrink-0 z-20 transition-all duration-200">
        
        {/* Cabecera del Sidebar */}
        <div className="h-14 bg-[#202c33] px-3.5 flex items-center justify-between border-b border-[#222d34] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#00a884] text-[#111b21] flex items-center justify-center font-bold text-sm shadow">
              LJ
            </div>
            <div>
              <h1 className="text-sm font-semibold text-[#e9edef] leading-tight">WhatsApp Laujim</h1>
              <span className="text-[11px] text-[#00a884] flex items-center gap-1 font-medium">
                <span className={`w-1.5 h-1.5 rounded-full ${status?.ready ? 'bg-[#00a884] animate-pulse' : 'bg-rose-400'}`}></span>
                {status?.ready ? 'Cloud API conectada' : 'Requiere configuración'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[#aebac1]">
            <button type="button" onClick={loadConversations} className="p-2 hover:bg-white/10 rounded-full transition active:scale-95" title="Actualizar">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => openPanel('settings')} className="p-2 hover:bg-white/10 rounded-full transition active:scale-95" title="Ajustes">
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Buscador */}
        <div className="p-2.5 bg-[#111b21]">
          <div className="relative flex items-center bg-[#202c33] rounded-lg px-3 py-1.5 focus-within:ring-1 focus-within:ring-[#00a884]">
            <Search className="w-4 h-4 text-[#8696a0] mr-2 shrink-0" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar contactos o apartamentos"
              className="w-full bg-transparent text-xs text-[#e9edef] placeholder-[#8696a0] outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-white text-xs">✕</button>
            )}
          </div>
        </div>

        {/* Pestañas de Filtro */}
        <div className="px-3 py-1.5 bg-[#111b21] flex items-center gap-2 border-b border-[#222d34]">
          <button
            type="button"
            onClick={() => setListFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
              listFilter === 'all'
                ? 'bg-[#202c33] text-[#00a884] border border-[#00a884]/30'
                : 'bg-transparent text-[#8696a0] hover:bg-[#202c33]'
            }`}
          >
            Todos ({conversations.length})
          </button>
          <button
            type="button"
            onClick={() => setListFilter('unread')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
              listFilter === 'unread'
                ? 'bg-[#202c33] text-[#00a884] border border-[#00a884]/30'
                : 'bg-transparent text-[#8696a0] hover:bg-[#202c33]'
            }`}
          >
            No leídos ({conversations.filter(c => Number(c.unreadCount || 0) > 0).length})
          </button>
        </div>

        {/* Lista de Chats */}
        <div className="wa-live-conversation-list flex-1 overflow-y-auto divide-y divide-[#222d34]/60">
          {loading ? (
            <p className="p-6 text-center text-xs text-[#8696a0]">Cargando conversaciones…</p>
          ) : !visibleConversations.length && !matchingContacts.length ? (
            <p className="p-6 text-center text-xs text-[#8696a0]">
              {listFilter === 'unread' ? 'No hay conversaciones sin leer.' : 'No hay conversaciones ni contactos encontrados.'}
            </p>
          ) : (
            <>
              {visibleConversations.map(conversation => {
                const isSelected = selected === conversation.id;
                const unread = Number(conversation.unreadCount || 0);
                const latestInbound = conversation.lastInboundAt ? new Date(conversation.lastInboundAt).getTime() : 0;
                const cWindowOpen = Boolean(conversation.windowOpen || Math.max(new Date(conversation.customerServiceWindowUntil || 0).getTime(), latestInbound + 24 * 60 * 60 * 1000) > Date.now());

                return (
                  <div
                    key={conversation.id}
                    onClick={() => openConversation(conversation.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition select-none ${
                      isSelected ? 'bg-[#2a3942]/70' : 'hover:bg-[#202c33]/50'
                    }`}
                  >
                    <div className={`w-11 h-11 rounded-full font-bold text-xs flex items-center justify-center shrink-0 shadow ${
                      isSelected ? 'bg-[#00a884] text-[#111b21]' : 'bg-[#1e3a47] text-[#00a884]'
                    }`}>
                      {apartmentBadge(conversation)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#e9edef] truncate">
                          {conversation.tenantName || `Inquilino (${conversation.phone})`}
                        </span>
                        <span className={`text-[11px] shrink-0 ml-1 ${unread > 0 ? 'text-[#00a884] font-semibold' : 'text-[#8696a0]'}`}>
                          {listTime(conversation.lastInboundAt || conversation.messages?.[0]?.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-xs text-[#8696a0] truncate">
                          {previewText(conversation)}
                        </p>
                        {unread > 0 && (
                          <span className="w-4 h-4 rounded-full bg-[#00a884] text-[#111b21] text-[10px] font-bold flex items-center justify-center shrink-0 ml-1 shadow">
                            {unread}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px]">
                        <span className={`w-1.5 h-1.5 rounded-full ${cWindowOpen ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        <span className={cWindowOpen ? 'text-emerald-300' : 'text-amber-300'}>
                          {cWindowOpen ? 'Ventana activa' : 'Requiere plantilla'} · Apto. {conversation.apartmentName || conversation.apartmentId || '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Contactos encontrados por búsqueda de apartamento o nombre */}
              {matchingContacts.length > 0 && (
                <div className="border-t border-[#222d34] bg-[#111b21]/70">
                  <div className="px-3 py-1.5 text-[10.5px] font-bold text-[#00a884] uppercase tracking-wider bg-[#182229]/60 flex items-center justify-between">
                    <span>Contactos y Residentes ({matchingContacts.length})</span>
                    <span className="text-gray-400 font-normal text-[10px]">Toca para abrir chat</span>
                  </div>
                  {matchingContacts.map(contact => (
                    <div
                      key={contact.tenantId || contact.phone}
                      onClick={() => startConversationWithContact(contact)}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#202c33]/70 transition select-none border-b border-[#222d34]/40"
                    >
                      <div className="w-11 h-11 rounded-full bg-[#1e3a47] text-[#00a884] font-bold text-xs flex items-center justify-center shrink-0 shadow">
                        {contact.apartmentName || contact.apartmentId || '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-[#e9edef] truncate">{contact.name}</span>
                          <span className="text-[10px] text-[#00a884] font-medium bg-[#00a884]/15 px-2 py-0.5 rounded-full shrink-0 ml-1">
                            {startingContactId === contact.tenantId ? 'Iniciando…' : 'Iniciar chat'}
                          </span>
                        </div>
                        <p className="text-xs text-[#8696a0] truncate mt-0.5">
                          {contact.phone} · Apto. {contact.apartmentName || contact.apartmentId || '—'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Salir al Dashboard */}
        <div className="p-2.5 bg-[#111b21] border-t border-[#222d34] flex items-center justify-between text-[11px] text-[#8696a0] shrink-0">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1.5 text-rose-400 hover:text-rose-300 font-medium px-2 py-1 rounded hover:bg-rose-500/10 transition active:scale-95"
            title="Salir al Dashboard"
          >
            <X className="w-3.5 h-3.5" />
            <span>Salir al Dashboard</span>
          </button>
          <span className="truncate">Canal oficial Laujim</span>
        </div>
      </aside>

      {/* ================= 2. ÁREA DE CHAT ACTIVO ================= */}
      <section className="wa-live-chat flex-1 flex flex-col bg-[#0b141a] h-full relative overflow-hidden">
        {!selectedConversation ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-[#8696a0] wa-doodle-bg">
            <div className="w-16 h-16 rounded-full bg-[#202c33] flex items-center justify-center mb-3 shadow-lg">
              <Lock className="w-8 h-8 text-[#00a884]" />
            </div>
            <h2 className="text-base font-semibold text-[#e9edef] mb-1">WhatsApp Cloud Edificio Laujim</h2>
            <p className="text-xs text-[#8696a0] max-w-sm">
              Selecciona una conversación autorizada en el panel izquierdo para ver el historial y responder.
            </p>
          </div>
        ) : (
          <>
            {/* Cabecera del Chat */}
            <header className="h-14 bg-[#202c33] px-2.5 sm:px-3 flex items-center justify-between border-b border-[#222d34] shrink-0 z-20">
              <div className="flex items-center gap-2 min-w-0">
                {/* Botón Volver a Lista en móvil */}
                <button
                  type="button"
                  onClick={returnToConversationList}
                  className="md:hidden p-1.5 hover:bg-white/10 rounded-full text-[#aebac1] transition active:scale-90 flex items-center"
                  title="Volver a la lista"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                {/* Avatar */}
                <div
                  onClick={() => openPanel('info')}
                  className="w-9 h-9 rounded-full bg-[#1e3a47] border border-[#00a884]/40 text-[#00a884] font-bold text-xs flex items-center justify-center shrink-0 shadow cursor-pointer"
                >
                  {apartmentBadge(selectedConversation)}
                </div>

                {/* Info Inquilino */}
                <div className="min-w-0 cursor-pointer" onClick={() => openPanel('info')}>
                  <h2 className="text-sm font-semibold text-[#e9edef] truncate leading-tight hover:underline">
                    {selectedConversation.tenantName || 'Inquilino'}
                  </h2>
                  <p className="text-[11px] text-[#8696a0] truncate">
                    {selectedConversation.phone} · Apto. {selectedConversation.apartmentName || selectedConversation.apartmentId || '—'}
                  </p>
                </div>
              </div>

              {/* Acciones de Cabecera */}
              <div className="flex items-center gap-0.5 text-[#aebac1] shrink-0">
                <button
                  type="button"
                  onClick={() => openPanel('chat-search')}
                  className="p-2 hover:bg-white/10 rounded-full transition active:scale-95"
                  title="Buscar en esta conversación"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => openPanel('info')}
                  className={`p-2 hover:bg-white/10 rounded-full transition active:scale-95 ${activePanel === 'info' ? 'text-[#00a884] bg-white/5' : ''}`}
                  title="Información del residente"
                >
                  <Info className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleTemplates}
                  className={`p-2 hover:bg-white/10 rounded-full transition active:scale-95 ${!windowOpen ? 'text-amber-400 bg-amber-500/10' : 'text-amber-400'}`}
                  title="Plantillas oficiales de Meta"
                >
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedConversation}
                  disabled={deleting === `conversation:${selectedConversation.id}`}
                  className="p-2 hover:bg-white/10 rounded-full text-rose-400 hover:text-rose-300 transition active:scale-95"
                  title="Eliminar conversación de Laujim"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition active:scale-95"
                  title="Salir al Dashboard"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Barra de Estado de la Ventana (24 Horas) */}
            <div className={`px-3.5 py-1 flex items-center justify-between text-[11px] transition-colors shrink-0 border-b ${
              windowOpen
                ? 'bg-[#182229] border-[#222d34] text-gray-300'
                : 'bg-[#241a18] border-[#4a2420] text-amber-200'
            }`}>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${windowOpen ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                <span className="font-medium">{windowRemainingLabel()}</span>
              </div>
              {!windowOpen && (
                <button
                  type="button"
                  onClick={toggleTemplates}
                  className="text-amber-400 hover:underline font-semibold text-[11px]"
                >
                  Elegir plantilla ›
                </button>
              )}
            </div>

            {/* Panel de Plantillas Meta Desplegable */}
            {showTemplates && (
              <div className="bg-[#1f2c34] border-b border-[#2a3942] p-3 text-xs text-gray-200 animate-pop-in shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <strong className="text-white text-xs block">Plantillas oficiales de Meta</strong>
                    <span className="text-[10px] text-gray-400">Obligatorias si la ventana de 24h está cerrada. Se completan con datos en vivo.</span>
                  </div>
                  <button type="button" onClick={() => setShowTemplates(false)} className="p-1 hover:bg-white/10 rounded-full text-gray-400">✕</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    disabled={!!templateSending || !!templatePreviewLoading}
                    onClick={() => loadTemplatePreview('greeting')}
                    className="px-3 py-2 rounded-lg bg-[#2a3942] hover:bg-[#32444f] text-left border border-gray-700/50 transition"
                  >
                    <strong className="block text-emerald-400 text-xs">1. Saludo Inicial</strong>
                    <span className="text-[11px] text-gray-300">{templatePreviewLoading === 'greeting' ? 'Preparando…' : '"Hola, ¿cómo estás? ¿Podemos hablar?"'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!!templateSending || !!templatePreviewLoading}
                    onClick={() => loadTemplatePreview('payment_reminder')}
                    className="px-3 py-2 rounded-lg bg-[#2a3942] hover:bg-[#32444f] text-left border border-gray-700/50 transition"
                  >
                    <strong className="block text-blue-400 text-xs">2. Cobro Canon + Servicios</strong>
                    <span className="text-[11px] text-gray-300">{templatePreviewLoading === 'payment_reminder' ? 'Preparando…' : 'Desglose de servicios públicos y botón de pago'}</span>
                  </button>
                </div>
                {templatePreview && (
                  <div className="p-2.5 rounded-lg bg-black/40 border border-[#3e7168] mt-2">
                    <div className="flex items-center justify-between text-xs text-emerald-300 font-bold mb-1">
                      <span>Vista previa: {templatePreview.templateName}</span>
                      <button onClick={() => setTemplatePreview(null)} className="text-gray-400 hover:text-white">✕</button>
                    </div>
                    <pre className="text-[11px] text-gray-200 whitespace-pre-wrap font-sans bg-black/30 p-2 rounded max-h-36 overflow-auto">
                      {templatePreview.previewText}
                    </pre>
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setTemplatePreview(null)}
                        className="px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={!!templateSending}
                        onClick={() => sendTemplate(templatePreview.template)}
                        className="px-3 py-1 rounded bg-[#00a884] text-[#111b21] font-bold text-xs hover:bg-[#06cf9c]"
                      >
                        {templateSending ? 'Enviando…' : 'Confirmar y Enviar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Contenedor de Mensajes con fondo Doodle */}
            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="wa-live-messages flex-1 overflow-y-auto px-3 sm:px-5 py-3 wa-doodle-bg flex flex-col space-y-2.5 relative"
            >
              {/* Separador de Fecha */}
              <div className="flex justify-center my-1 sticky top-1 z-10">
                <span className="bg-[#182229]/90 text-[#8696a0] text-[10.5px] px-3 py-0.5 rounded-lg uppercase tracking-wider font-semibold shadow border border-white/5 backdrop-blur-sm">
                  Hoy
                </span>
              </div>

              {!visibleMessages.length ? (
                <p className="text-center text-xs text-[#8696a0] my-8">Aún no hay mensajes en esta conversación.</p>
              ) : (
                visibleMessages.map(message => {
                  const isOut = message.direction === 'out';
                  return (
                    <div
                      key={message.id}
                      id={`msg-${message.id}`}
                      className={`flex ${isOut ? 'justify-end' : 'justify-start'} animate-pop-in`}
                    >
                      <div className={`${isOut ? 'bubble-out' : 'bubble-in'} max-w-[86%] sm:max-w-[75%] px-3 py-2 text-[#e9edef] shadow-md relative group`}>
                        {/* Botón eliminar de Laujim */}
                        <button
                          type="button"
                          onClick={() => deleteMessageFromLaujim(message)}
                          disabled={deleting === `message:${message.id}`}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded-full bg-black/40 text-gray-300 hover:text-rose-400 transition"
                          title="Eliminar de Laujim"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>

                        {message.text && (
                          <p className="leading-relaxed text-sm whitespace-pre-wrap">{message.text}</p>
                        )}
                        {message.interaction && (
                          <div className="text-xs font-semibold text-emerald-400 mb-1">
                            🔘 Respuesta rápida: "{message.interaction.displayText || message.interaction.title}"
                          </div>
                        )}
                        <MediaMessage message={message} />

                        <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-[#8696a0] select-none">
                          <span>{formatTimeOnly(message.createdAt)}</span>
                          {isOut && (
                            <span className="ml-0.5 text-xs">
                              <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} className="h-2" />
            </div>

            {/* Botón Flotante Ir al Último Mensaje (↓) */}
            {showScrollBottom && (
              <button
                type="button"
                onClick={() => scrollToBottom('smooth')}
                className="absolute right-4 bottom-16 z-30 w-9 h-9 rounded-full bg-[#202c33] hover:bg-[#2a3942] text-[#8696a0] hover:text-white flex items-center justify-center shadow-lg border border-[#2a3942] transition active:scale-90"
                title="Ir al último mensaje"
              >
                ↓
              </button>
            )}

            {/* Previsualización de Adjunto */}
            {attachment && (
              <div className="bg-[#1f2c34] border-t border-[#2a3942] px-3 py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <MediaIcon type={attachmentKind(attachment)} className="w-4 h-4 text-emerald-400" />
                  <span className="text-white font-medium truncate">{attachment.name}</span>
                </div>
                <button type="button" onClick={clearAttachment} className="text-rose-400 hover:text-rose-300 text-xs px-2 py-0.5 rounded">
                  Quitar
                </button>
              </div>
            )}

            {/* Banner de Grabación de Nota de Voz */}
            {recording && (
              <div className="bg-[#111b21] border-t border-[#222d34] px-3 py-2 flex items-center justify-between text-xs z-20">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                  <span className="font-mono text-rose-400 font-bold text-sm">
                    {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
                  </span>
                  <span className="text-gray-400 text-[11px]">Grabando nota de voz…</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={cancelRecording} className="px-2 py-1 text-rose-400 hover:bg-rose-500/10 rounded text-xs font-semibold">
                    Cancelar
                  </button>
                  <button type="button" onClick={() => stopRecording()} className="px-3 py-1 bg-[#00a884] text-[#111b21] rounded-full font-bold hover:bg-[#06cf9c] text-xs flex items-center gap-1">
                    <Square className="w-3 h-3" /> Listo
                  </button>
                </div>
              </div>
            )}

            {/* ================= COMPOSITOR INFERIOR WHATSAPP ================= */}
            <footer className="bg-[#202c33] px-2 py-1.5 flex items-center gap-1.5 shrink-0 z-20 border-t border-[#222d34]">
              {/* Inputs ocultos de archivo */}
              <input ref={fileInput} type="file" className="hidden" accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={e => handleAttachmentFile(e.target.files?.[0] || null)} />
              <input ref={galleryInput} type="file" className="hidden" accept="image/*,video/*" onChange={e => handleAttachmentFile(e.target.files?.[0] || null)} />
              <input ref={cameraPhotoInput} type="file" className="hidden" accept="image/*" capture="environment" onChange={e => handleAttachmentFile(e.target.files?.[0] || null)} />
              <input ref={cameraVideoInput} type="file" className="hidden" accept="video/*" capture="environment" onChange={e => handleAttachmentFile(e.target.files?.[0] || null)} />

              {/* Pastilla Flotante de Entrada */}
              <div className={`flex-1 rounded-2xl flex items-center px-2 py-1 gap-1 transition-colors ${
                windowOpen
                  ? 'bg-[#2a3942] focus-within:ring-1 focus-within:ring-[#00a884]'
                  : 'bg-[#182229] border border-gray-700/60 opacity-80 cursor-not-allowed'
              }`}>
                {/* Emoji */}
                <button
                  type="button"
                  onClick={() => { if (windowOpen) setDraft(d => d + '😊'); }}
                  disabled={!windowOpen || sending || recording}
                  className="p-1 text-[#8696a0] hover:text-[#e9edef] transition disabled:opacity-40"
                  title="Emojis"
                >
                  <Smile className="w-5 h-5" />
                </button>

                {/* Campo de Texto */}
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && windowOpen) sendMessage(e); }}
                  disabled={!windowOpen || sending || recording}
                  placeholder={
                    recording
                      ? 'Grabando nota de voz…'
                      : windowOpen
                      ? 'Escribe un mensaje'
                      : 'Por favor envía una plantilla para iniciar la interacción'
                  }
                  className={`flex-1 bg-transparent text-sm outline-none px-1 py-1 min-w-0 ${
                    windowOpen ? 'text-[#e9edef] placeholder-[#8696a0]' : 'text-gray-400 placeholder-gray-400 cursor-not-allowed text-xs'
                  }`}
                />

                {/* Clip Adjuntos */}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={!windowOpen || sending || recording}
                  className="p-1 text-[#8696a0] hover:text-[#e9edef] transition disabled:opacity-40"
                  title="Adjuntar archivo o documento"
                >
                  <Paperclip className="w-5 h-5" />
                </button>

                {/* Cámara Rápida */}
                <button
                  type="button"
                  onClick={() => cameraPhotoInput.current?.click()}
                  disabled={!windowOpen || sending || recording}
                  className="p-1 text-[#8696a0] hover:text-[#e9edef] transition disabled:opacity-40"
                  title="Tomar foto de evidencia"
                >
                  <Camera className="w-5 h-5" />
                </button>
              </div>

              {/* Botón Circular Flotante: Micrófono o Enviar */}
              <button
                type="button"
                onClick={e => {
                  if (!windowOpen) {
                    toggleTemplates();
                    return;
                  }
                  if (draft.trim() || attachment) {
                    sendMessage(e);
                  } else {
                    startRecording();
                  }
                }}
                disabled={sending}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition active:scale-90 shrink-0 ${
                  windowOpen
                    ? 'bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] shadow-lg'
                    : 'bg-gray-700 text-gray-400 cursor-not-allowed opacity-60'
                }`}
                title={
                  !windowOpen
                    ? 'Por favor envía una plantilla para iniciar la interacción'
                    : draft.trim() || attachment
                    ? 'Enviar mensaje'
                    : 'Grabar nota de voz'
                }
              >
                {!windowOpen ? (
                  <FileText className="w-4 h-4" />
                ) : draft.trim() || attachment ? (
                  <Send className="w-4 h-4 font-bold ml-0.5" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>
            </footer>
          </>
        )}

        {/* ================= DRAWER LATERAL DE BÚSQUEDA EN EL CHAT ================= */}
        {activePanel === 'chat-search' && selectedConversation && (
          <aside className="w-72 sm:w-80 bg-[#111b21] border-l border-[#222d34] absolute right-0 top-0 bottom-0 z-30 flex flex-col text-xs shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between p-3 border-b border-[#222d34]">
              <strong className="text-sm text-white flex items-center gap-2">
                <Search className="w-4 h-4 text-[#00a884]" /> Buscar en este chat
              </strong>
              <button onClick={() => { setActivePanel(null); setChatSearchQuery(''); }} className="text-gray-400 hover:text-white p-1">✕</button>
            </div>
            <div className="p-3 border-b border-[#222d34]">
              <div className="relative flex items-center bg-[#202c33] rounded-lg px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-[#00a884]">
                <Search className="w-3.5 h-3.5 text-[#8696a0] mr-2 shrink-0" />
                <input
                  value={chatSearchQuery}
                  onChange={e => setChatSearchQuery(e.target.value)}
                  placeholder="Buscar texto en los mensajes..."
                  className="w-full bg-transparent text-xs text-[#e9edef] placeholder-[#8696a0] outline-none"
                  autoFocus
                />
                {chatSearchQuery && (
                  <button onClick={() => setChatSearchQuery('')} className="text-gray-400 hover:text-white text-xs">✕</button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {chatSearchQuery ? (
                messages.filter(m => {
                  const q = chatSearchQuery.toLowerCase();
                  return (m.text && m.text.toLowerCase().includes(q)) ||
                    (m.media?.fileName && m.media.fileName.toLowerCase().includes(q)) ||
                    (m.transcript && m.transcript.toLowerCase().includes(q));
                }).length === 0 ? (
                  <p className="p-4 text-center text-[#8696a0] text-xs">No se encontraron mensajes que coincidan.</p>
                ) : (
                  messages.filter(m => {
                    const q = chatSearchQuery.toLowerCase();
                    return (m.text && m.text.toLowerCase().includes(q)) ||
                      (m.media?.fileName && m.media.fileName.toLowerCase().includes(q)) ||
                      (m.transcript && m.transcript.toLowerCase().includes(q));
                  }).map(msg => (
                    <div
                      key={msg.id}
                      className="p-2.5 rounded-lg bg-[#202c33] hover:bg-[#2a3942] transition border border-[#2a3942]/40 space-y-1 cursor-pointer"
                      onClick={() => {
                        const el = document.getElementById(`msg-${msg.id}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    >
                      <div className="flex items-center justify-between text-[10px] text-[#8696a0]">
                        <span className={msg.direction === 'out' ? 'text-[#00a884]' : 'text-[#53bdeb]'}>
                          {msg.direction === 'out' ? 'Tú' : (selectedConversation.tenantName || 'Residente')}
                        </span>
                        <span>{listTime(msg.createdAt)}</span>
                      </div>
                      <p className="text-xs text-[#e9edef] line-clamp-3">{msg.text || (msg.media?.voice ? '🎙 Nota de voz' : msg.media?.fileName || `[${msg.type}]`)}</p>
                    </div>
                  ))
                )
              ) : (
                <p className="p-4 text-center text-[#8696a0] text-xs">Escribe una palabra para buscar en esta conversación.</p>
              )}
            </div>
          </aside>
        )}

        {/* ================= DRAWER LATERAL DE INFO (Deslizable, NO bloquea el chat) ================= */}
        {activePanel === 'info' && selectedConversation && (
          <aside className="w-72 sm:w-80 bg-[#111b21] border-l border-[#222d34] absolute right-0 top-0 bottom-0 z-30 flex flex-col p-4 text-xs shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#222d34] mb-3">
              <strong className="text-sm text-white">Info del Residente</strong>
              <button onClick={() => setActivePanel(null)} className="text-gray-400 hover:text-white p-1">✕</button>
            </div>
            <div className="flex flex-col items-center text-center py-3 border-b border-[#222d34]">
              <div className="w-16 h-16 rounded-full bg-[#1e3a47] border border-[#00a884]/40 text-[#00a884] font-bold text-xl flex items-center justify-center mb-2 shadow">
                {apartmentBadge(selectedConversation)}
              </div>
              <strong className="text-white text-sm">{selectedConversation.tenantName || 'Inquilino'}</strong>
              <span className="text-gray-400 text-xs">{selectedConversation.phone}</span>
              <span className="mt-2 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-semibold text-[11px]">
                Apto. {selectedConversation.apartmentName || selectedConversation.apartmentId || '—'} · Al día
              </span>
            </div>
            <div className="py-3 space-y-2.5 text-xs flex-1 overflow-y-auto">
              <div>
                <span className="text-[#8696a0] block text-[10px] uppercase font-semibold">Ventana de Meta Cloud</span>
                <p className={`mt-0.5 font-medium ${windowOpen ? 'text-emerald-400' : 'text-amber-400'}`}>
                  ● {windowRemainingLabel()}
                </p>
              </div>
              <div>
                <span className="text-[#8696a0] block text-[10px] uppercase font-semibold">Acciones Disponibles</span>
                <p className="text-gray-300 mt-0.5">Mensajes libres, notas de voz con ondas, transcripción automática y cobro de servicios.</p>
              </div>
              <div>
                <span className="text-[#8696a0] block text-[10px] uppercase font-semibold">Regla Oficial de Meta</span>
                <p className="text-gray-300 mt-0.5">La ventana de 24 horas se renueva automáticamente cada vez que el residente responde un mensaje o plantilla.</p>
              </div>
            </div>
          </aside>
        )}

        {/* Modal Ajustes */}
        {activePanel === 'settings' && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="bg-[#202c33] border border-[#2a3942] rounded-2xl w-full max-w-sm p-4 text-gray-200 shadow-2xl animate-pop-in">
              <div className="flex items-center justify-between pb-2 border-b border-[#2a3942] mb-3">
                <h3 className="text-sm font-semibold text-white">Ajustes WhatsApp Laujim</h3>
                <button onClick={() => setActivePanel(null)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <div className="space-y-2.5 text-xs">
                {[['whatsapp', 'Notificaciones de WhatsApp'], ['scraper', 'Alertas del Scraper'], ['sound', 'Sonidos de mensaje']].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between p-2 rounded-lg bg-[#2a3942]/60 cursor-pointer">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(notificationPrefs[key])}
                      onChange={() => toggleNotification(key)}
                      className="accent-[#00a884]"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setActivePanel(null)}
                  className="px-3 py-1.5 rounded-lg bg-[#00a884] text-[#111b21] font-bold text-xs hover:bg-[#06cf9c]"
                >
                  Aceptar
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}