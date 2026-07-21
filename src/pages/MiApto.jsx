import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Calendar, DollarSign, FileText, Droplets, Flame, Zap, LogOut, Download, Hash, Phone, MapPin, CheckCircle2, MessageCircle, Send, ChevronDown } from 'lucide-react';
import { getAuth, clearAuth, isTenant } from '../utils/auth';
import { api } from '../api';
import { formatCurrency, formatShortDate, formatRelativeDueDate, getCurrentPeriod } from '../utils/helpers';
import { sendMessage, getRoomMessages, startChatPoll, stopChatPoll, fetchPresence, startHeartbeat, stopHeartbeat, startPresencePoll, stopPresencePoll, getStatusLabel, sendHeartbeat } from '../utils/chat';

export default function MiApto() {
  const navigate = useNavigate();
  const [apt, setApt] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [contract, setContract] = useState(null);
  const [payments, setPayments] = useState([]);
  const [auth, setAuth] = useState(getAuth());
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const chatBottomRef = useRef(null);
  const [chatError, setChatError] = useState('');
  const [presence, setPresence] = useState([]);

  useEffect(() => {
    if (!isTenant()) { navigate('/login', { replace: true }); return; }
    loadData();
    const a = getAuth();
    let onHide, onVis;
    if (a && a.apartmentId) {
      const roomId = 'admin-' + a.apartmentId;
      const userId = a.username || 'apt-' + a.apartmentId;
      getRoomMessages(roomId).then(setChatMsgs);
      startChatPoll(newMsgs => {
        if (newMsgs.some(m => m.roomId === roomId)) {
          getRoomMessages(roomId).then(setChatMsgs);
        }
      }, 3000);
      startHeartbeat(userId, 10000);
      startPresencePoll(data => setPresence(data || []), 5000);
      onHide = () => sendHeartbeat(userId, 'offline');
      onVis = () => sendHeartbeat(userId, document.hidden ? 'away' : 'online');
      window.addEventListener('beforeunload', onHide);
      document.addEventListener('visibilitychange', onVis);
    }
    return () => {
      stopChatPoll(); stopHeartbeat(); stopPresencePoll();
      if (onHide) window.removeEventListener('beforeunload', onHide);
      if (onVis) document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs]);

  async function loadData() {
    const a = getAuth();
    if (!a || !a.apartmentId) return;
    const [apartments, tenants, contracts, allPayments] = await Promise.all([
      api.apartments.toArray(), api.tenants.toArray(), api.contracts.toArray(), api.payments.toArray(),
    ]);
    const apt = apartments.find(x => x.id === a.apartmentId);
    const contract = contracts.find(c => c.apartmentId === a.apartmentId && (!c.endDate || new Date(c.endDate) > new Date()));
    const tenant = contract ? tenants.find(t => t.id === contract.tenantId) : null;
    const aptPayments = allPayments.filter(p => p.apartmentId === a.apartmentId && p.type === 'rent').sort((a, b) => new Date(b.date) - new Date(a.date));
    setApt(apt);
    setContract(contract);
    setTenant(tenant);
    setPayments(aptPayments);
  }

  function handleLogout() {
    clearAuth();
    navigate('/login', { replace: true });
  }

  async function handleChatSend(e) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !auth.apartmentId) return;
    setChatInput('');
    const roomId = 'admin-' + auth.apartmentId;
    const from = auth.username || 'apt-' + auth.apartmentId;
    try { await sendMessage(roomId, from, 'admin', text); } catch { setChatError('Error al enviar'); setTimeout(() => setChatError(''), 3000); }
    getRoomMessages(roomId).then(setChatMsgs);
  }

  const adminStatus = getStatusLabel(presence, 'admin');

  if (!apt) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <p className="text-gray-400">Cargando...</p>
    </div>
  );

  const currentPeriod = getCurrentPeriod();
  const paidThisPeriod = payments.some(p => p.date && p.date.startsWith(currentPeriod));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-lg mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">{apt.name}</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {tenant ? `Inquilino: ${tenant.name}` : 'Sin inquilino'}
              </p>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors">
            <LogOut className="w-4 h-4" /> Salir
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Información de Pago</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-sm text-gray-500 dark:text-gray-400">Canon de Arriendo</span>
              <strong className="text-gray-900 dark:text-white">{formatCurrency(contract?.monthlyRent || apt.monthlyRent)}</strong>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-sm text-gray-500 dark:text-gray-400">Día de Pago</span>
              <strong className="text-gray-900 dark:text-white">Día {apt.paymentDueDay}</strong>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-sm text-gray-500 dark:text-gray-400">Estado</span>
              {paidThisPeriod ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Pagado este mes
                </span>
              ) : (
                <span className="text-amber-600 font-medium text-sm">{formatRelativeDueDate(apt.paymentDueDay)}</span>
              )}
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">Depósito</span>
              <strong className="text-gray-900 dark:text-white">{contract?.depositPaid ? '✓ Pagado' : '✗ Pendiente'}</strong>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2"><Hash className="w-4 h-4" /> Códigos de Servicios</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <Droplets className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Triple A (Agua)</p>
                <p className="text-xs text-gray-500">N° Póliza: <strong className="text-gray-900 dark:text-white">{apt.waterPaymentCode || '-'}</strong></p>
                <p className="text-xs text-gray-500">Lectura día {apt.waterReadingDay || 7}</p>
              </div>
              <a href="https://portal.aaa.com.co/pagos" target="_blank" rel="noopener noreferrer" className="ml-auto px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shrink-0">Pagar</a>
            </div>
            <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
              <Flame className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Gases del Caribe</p>
                <p className="text-xs text-gray-500">N° Contrato: <strong className="text-gray-900 dark:text-white">{apt.gasPaymentCode || '-'}</strong></p>
                <p className="text-xs text-gray-500">Lectura día {apt.gasReadingDay || 7}</p>
              </div>
              <a href="https://www.gascaribe.com/" target="_blank" rel="noopener noreferrer" className="ml-auto px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors shrink-0">Pagar</a>
            </div>
            <div className="flex items-start gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <Zap className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Air-e (Electricidad)</p>
                <p className="text-xs text-gray-500">NIC: <strong className="text-gray-900 dark:text-white">{apt.electricityPaymentCode || apt.nic || '-'}</strong></p>
                <p className="text-xs text-gray-500">Lectura día {apt.electricityReadingDay || 21}</p>
              </div>
              <a href="https://portal.air-e.com/Pagar#/List" target="_blank" rel="noopener noreferrer" className="ml-auto px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shrink-0">Pagar</a>
            </div>
          </div>
        </div>

        {contract && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2"><FileText className="w-4 h-4" /> Contrato</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">Inicio</span>
                <strong className="text-gray-900 dark:text-white">{formatShortDate(contract.startDate)}</strong>
              </div>
              {contract.endDate && (
                <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-gray-500 dark:text-gray-400">Fin</span>
                  <strong className="text-gray-900 dark:text-white">{formatShortDate(contract.endDate)}</strong>
                </div>
              )}
              <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">Canon</span>
                <strong className="text-gray-900 dark:text-white">{formatCurrency(contract.monthlyRent)}/mes</strong>
              </div>
              {contract.contractFile && (
                <a href={contract.contractFile} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium">
                  <Download className="w-4 h-4" /> Descargar Contrato
                </a>
              )}
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" /> Historial de Pagos</h3>
          {payments.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Sin pagos registrados</p>
          ) : (
            <div className="space-y-1">
              {payments.slice(0, 12).map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{formatShortDate(p.date)}</span>
                  <div className="flex items-center gap-2">
                    {p.period && <span className="text-xs text-gray-400">{p.period}</span>}
                    <strong className="text-emerald-600">{formatCurrency(p.amount)}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat con Administrador */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <MessageCircle className="w-4 h-4" /> Chat con Administrador
              <span className={`w-2 h-2 rounded-full ${adminStatus.dot} inline-block shrink-0`} title={adminStatus.label} />
            </h3>
            <div className="text-[10px] text-gray-400">{adminStatus.label}</div>
          </div>
          <div className="h-48 overflow-y-auto p-3 space-y-2 bg-gray-50 dark:bg-gray-900/50">
            {chatMsgs.length === 0 && <p className="text-xs text-gray-400 text-center mt-6">Sin mensajes aún</p>}
            {chatMsgs.map(msg => {
              const isMine = msg.from !== 'admin';
              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-1.5 rounded-lg text-sm ${isMine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-sm border border-gray-200 dark:border-gray-600'}`}>
                    <div>{msg.content}</div>
                    <div className={`text-[10px] mt-0.5 ${isMine ? 'text-blue-200' : 'text-gray-400'}`}>
                      {new Date(msg.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={chatBottomRef} />
          </div>
          <form onSubmit={handleChatSend} className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Escribe un mensaje..." className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
            <button type="submit" disabled={!chatInput.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <Send className="w-4 h-4" />
            </button>
          </form>
          {chatError && <p className="text-xs text-red-500 px-3 pb-2">{chatError}</p>}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2"><MapPin className="w-4 h-4" /> Información del Apartamento</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {apt.area > 0 && <><span className="text-gray-500">Área:</span><strong className="text-gray-900">{apt.area} m²</strong></>}
            {apt.floor > 0 && <><span className="text-gray-500">Piso:</span><strong className="text-gray-900">{apt.floor}</strong></>}
            {apt.rooms > 0 && <><span className="text-gray-500">Habitaciones:</span><strong className="text-gray-900">{apt.rooms}</strong></>}
            {apt.bathrooms > 0 && <><span className="text-gray-500">Baños:</span><strong className="text-gray-900">{apt.bathrooms}</strong></>}
          </div>
        </div>
      </div>
    </div>
  );
}
