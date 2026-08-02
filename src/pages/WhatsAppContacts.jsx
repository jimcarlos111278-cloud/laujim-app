import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, RefreshCw, Users } from 'lucide-react';
import { AUTH_TOKEN, getBase } from '../utils/config';

export default function WhatsAppContacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(getBase() + '/whatsapp/cloud/contacts', { headers: { 'x-auth-token': AUTH_TOKEN } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No fue posible cargar los contactos');
      setContacts(data); setError('');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return <div className="p-4 md:p-6 max-w-5xl mx-auto">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div><h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><Users className="w-6 h-6 text-emerald-600" /> Contactos WhatsApp</h1><p className="text-sm text-gray-500 dark:text-gray-400">Residentes con contrato activo. Sus nombres se toman automáticamente de la base de datos.</p></div>
      <button onClick={load} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"><RefreshCw className="w-4 h-4" /> Actualizar</button>
    </div>
    <div className="mb-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 px-4 py-3 text-sm">Puedes responder libremente durante las 24 horas posteriores a un mensaje del residente. Para iniciar una conversación después de ese plazo, Meta exige una plantilla aprobada y consentimiento previo del contacto.</div>
    {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {loading ? <p className="p-5 text-sm text-gray-500">Cargando contactos…</p> : contacts.length === 0 ? <p className="p-5 text-sm text-gray-500">No hay residentes activos con teléfono registrado.</p> : <div className="divide-y divide-gray-100 dark:divide-gray-700">{contacts.map(contact => <div key={contact.tenantId} className="p-4 flex flex-wrap items-center gap-3 justify-between"><div><p className="font-medium text-gray-900 dark:text-white">{contact.name}</p><p className="text-sm text-gray-500">{contact.phone} · Apartamento {contact.apartmentName || contact.apartmentId}</p></div><div className="flex items-center gap-3"><span className={`text-xs font-medium ${contact.windowOpen ? 'text-emerald-600' : 'text-amber-600'}`}>{contact.windowOpen ? 'Puede responderse ahora' : 'Requiere plantilla para iniciar'}</span>{contact.conversationId ? <Link to={`/whatsapp?conversation=${contact.conversationId}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm"><MessageCircle className="w-4 h-4" /> Ver conversación</Link> : <span className="text-xs text-gray-400">Sin conversación aún</span>}</div></div>)}</div>}
    </div>
  </div>;
}
