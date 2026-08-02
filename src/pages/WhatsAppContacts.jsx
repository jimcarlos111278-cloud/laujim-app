import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle, Phone, RefreshCw, Send, Users } from 'lucide-react';
import { AUTH_TOKEN, getBase } from '../utils/config';

export default function WhatsAppContacts() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startingId, setStartingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(getBase() + '/whatsapp/cloud/contacts', { headers: { 'x-auth-token': AUTH_TOKEN } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No fue posible cargar los contactos');
      setContacts(data);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function startConversation(contact) {
    setStartingId(contact.tenantId);
    setError('');
    try {
      const response = await fetch(getBase() + '/whatsapp/cloud/start-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ tenantId: contact.tenantId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No fue posible iniciar la conversación');
      await load();
      navigate(`/whatsapp?conversation=${data.conversationId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setStartingId(null);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><Users className="w-6 h-6 text-emerald-600" /> Contactos WhatsApp</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Todos los inquilinos registrados con teléfono en la base de datos.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"><RefreshCw className="w-4 h-4" /> Actualizar</button>
      </div>

      <div className="mb-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 px-4 py-3 text-sm">
        Todo inquilino registrado con teléfono aparece aquí y puede usar el canal oficial. Si la ventana de 24 horas no está abierta, se envía la plantilla de saludo aprobada.
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? <p className="p-5 text-sm text-gray-500">Cargando contactos…</p> : contacts.length === 0 ? <p className="p-5 text-sm text-gray-500">No hay inquilinos con teléfono registrado.</p> : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {contacts.map(contact => (
              <div key={contact.tenantId} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{contact.name}</p>
                  <p className="text-sm text-gray-500">{contact.phone} · {contact.apartmentName ? `Apartamento ${contact.apartmentName}` : 'Sin apartamento asignado'}</p>
                  {!contact.activeContract && <p className="text-xs text-amber-600 mt-1">Registrado sin contrato activo</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-medium ${contact.windowOpen ? 'text-emerald-600' : 'text-amber-600'}`}>{contact.windowOpen ? 'Puede responderse ahora' : 'Requiere plantilla para iniciar'}</span>
                  <a href={`tel:+${contact.phone}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200"><Phone className="w-4 h-4" /> Llamar</a>
                  {contact.windowOpen && contact.conversationId ? (
                    <Link to={`/whatsapp?conversation=${contact.conversationId}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm"><MessageCircle className="w-4 h-4" /> Abrir chat</Link>
                  ) : (
                    <button type="button" disabled={startingId === contact.tenantId} onClick={() => startConversation(contact)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"><Send className="w-4 h-4" /> {startingId === contact.tenantId ? 'Enviando…' : 'Iniciar conversación'}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
