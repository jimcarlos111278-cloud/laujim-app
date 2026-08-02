import { useCallback, useEffect, useState } from 'react';
import { Lock, MessageCircle, RefreshCw, Send } from 'lucide-react';
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

export default function WhatsAppInbox() {
  const [searchParams] = useSearchParams();
  const requestedConversation = Number(searchParams.get('conversation')) || null;
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

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

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selected || !windowOpen) return;
    setSending(true);
    try {
      await cloudRequest('/whatsapp/cloud/send', { method: 'POST', body: JSON.stringify({ conversationId: selected, text }) });
      setDraft('');
      await Promise.all([loadMessages(selected), loadConversations()]);
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
            <div className="p-4 border-b border-gray-200 dark:border-gray-700"><p className="font-semibold text-gray-900 dark:text-white">{selectedConversation.tenantName || 'Inquilino autorizado'}</p><p className="text-xs text-gray-500">{selectedConversation.phone} · Apartamento {selectedConversation.apartmentName || selectedConversation.apartmentId || '—'}</p></div>
            <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900/40">
              {messages.length === 0 ? <p className="text-sm text-gray-500 text-center pt-8">Cargando mensajes…</p> : messages.map(message => (
                <div key={message.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${message.direction === 'out' ? 'ml-auto bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600'}`}>
                  <p>{message.text || (message.type === 'text' ? 'Mensaje sin texto' : `Archivo ${message.type || ''}`)}</p><p className={`text-[10px] mt-1 ${message.direction === 'out' ? 'text-emerald-100' : 'text-gray-400'}`}>{formatDate(message.createdAt)}</p>
                </div>
              ))}
            </div>
            <form onSubmit={sendMessage} className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <input value={draft} onChange={e => setDraft(e.target.value)} disabled={!windowOpen || sending} placeholder={windowOpen ? 'Escribe una respuesta…' : 'La ventana de 24 h terminó: usa una plantilla aprobada'} className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm disabled:opacity-60" />
              <button disabled={!draft.trim() || !windowOpen || sending} className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"><Send className="w-4 h-4" /></button>
            </form>
          </>}
        </section>
      </div>
    </div>
  );
}
