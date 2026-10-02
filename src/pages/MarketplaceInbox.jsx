import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ShoppingBag, Globe, RefreshCw, Send, CheckCircle2, Clock, AlertTriangle,
  PauseCircle, Archive, Trash2, ExternalLink, MessageCircle, User, Phone,
  Search, Plus, Eye, Check, X, ShieldAlert, Sparkles, Building, ArrowUpRight
} from 'lucide-react';
import db from '../db/database';
import { api } from '../api';
import { getAuth } from '../utils/auth';

export default function MarketplaceInbox() {
  const auth = getAuth();
  const [apartments, setApartments] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [leads, setLeads] = useState([]);
  const [workerStatus, setWorkerStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('listings'); // 'listings' | 'chat' | 'logs'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState({});

  // Chat state
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [filterApartmentId, setFilterApartmentId] = useState('all');
  const [filterLeadStatus, setFilterLeadStatus] = useState('all');
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState({ name: '', phone: '', apartmentId: '', notes: '', message: '' });

  // Logs modal
  const [selectedJobLogs, setSelectedJobLogs] = useState(null);
  const [jobLogsData, setJobLogsData] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Confirm delete modal
  const [confirmDeleteApt, setConfirmDeleteApt] = useState(null);

  const chatEndRef = useRef(null);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [aptList, jobList, leadList, statusData] = await Promise.all([
        db.apartments.toArray(),
        api.marketplace.jobs().catch(() => []),
        api.marketplace.getLeads().catch(() => []),
        api.marketplace.status().catch(() => null),
      ]);
      setApartments(aptList || []);
      setJobs(jobList || []);
      setLeads(leadList || []);
      if (statusData?.ok) setWorkerStatus(statusData);
    } catch (e) {
      console.error('Error cargando Marketplace:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    const iv = setInterval(() => loadData(true), 15000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedLeadId, leads]);

  const activeApartments = useMemo(() => {
    return apartments.map(apt => {
      const activeJob = jobs.find(j => Number(j.apartmentId) === Number(apt.id) && ['queued', 'claimed', 'processing'].includes(j.status));
      const lastJob = jobs.find(j => Number(j.apartmentId) === Number(apt.id));
      return {
        ...apt,
        activeJob,
        lastJob,
        isPublished: Boolean(apt.marketplaceUrl) || apt.marketplaceStatus === 'published' || lastJob?.status === 'published',
        isPaused: apt.marketplaceStatus === 'paused',
        isArchived: apt.marketplaceStatus === 'archived',
        isDeleted: apt.marketplaceStatus === 'deleted',
      };
    });
  }, [apartments, jobs]);

  const selectedLead = useMemo(() => {
    return leads.find(l => l.id === selectedLeadId) || leads[0] || null;
  }, [leads, selectedLeadId]);

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (filterApartmentId !== 'all' && Number(l.apartmentId) !== Number(filterApartmentId)) return false;
      if (filterLeadStatus !== 'all' && l.status !== filterLeadStatus) return false;
      if (leadSearch.trim()) {
        const q = leadSearch.toLowerCase();
        return (l.name || '').toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.apartmentName || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [leads, filterApartmentId, filterLeadStatus, leadSearch]);

  const handleAction = async (aptId, action) => {
    setActionLoading(prev => ({ ...prev, [aptId]: action }));
    try {
      if (action === 'publish') {
        await api.marketplace.publish(aptId);
      } else {
        await api.marketplace.action(aptId, action);
      }
      await loadData(true);
    } catch (e) {
      alert(e.message || 'Error ejecutando acción');
    } finally {
      setActionLoading(prev => ({ ...prev, [aptId]: false }));
      setConfirmDeleteApt(null);
    }
  };

  const handleSendReply = async (e) => {
    e?.preventDefault();
    if (!chatInput.trim() || !selectedLead) return;
    const text = chatInput.trim();
    setChatInput('');
    try {
      const res = await api.marketplace.replyLead(selectedLead.id, text);
      if (res?.ok) {
        setLeads(prev => prev.map(l => l.id === selectedLead.id ? res.lead : l));
      }
    } catch (e) {
      alert('Error enviando mensaje: ' + e.message);
    }
  };

  const handleUpdateStatus = async (leadId, status) => {
    try {
      const res = await api.marketplace.updateLeadStatus(leadId, status);
      if (res?.ok) {
        setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleViewLogs = async (job) => {
    setSelectedJobLogs(job);
    setLoadingLogs(true);
    try {
      const logs = await api.marketplace.logs(job.id);
      setJobLogsData(logs || []);
    } catch (e) {
      setJobLogsData([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleCreateLead = async (e) => {
    e.preventDefault();
    if (!newLeadForm.name.trim()) return;
    const targetApt = apartments.find(a => Number(a.id) === Number(newLeadForm.apartmentId));
    try {
      const res = await api.marketplace.saveLead({
        name: newLeadForm.name.trim(),
        phone: newLeadForm.phone.trim(),
        apartmentId: targetApt ? targetApt.id : null,
        apartmentName: targetApt ? (targetApt.name || String(targetApt.id)) : '',
        notes: newLeadForm.notes.trim(),
        status: 'nuevo',
        messages: newLeadForm.message.trim() ? [{
          id: Date.now(),
          sender: 'lead',
          senderName: newLeadForm.name.trim(),
          text: newLeadForm.message.trim(),
          timestamp: new Date().toISOString()
        }] : []
      });
      if (res?.ok) {
        setLeads(prev => [res.lead, ...prev]);
        setSelectedLeadId(res.lead.id);
        setShowNewLeadModal(false);
        setNewLeadForm({ name: '', phone: '', apartmentId: '', notes: '', message: '' });
      }
    } catch (e) {
      alert('Error creando prospecto: ' + e.message);
    }
  };

  const formatPrice = (p) => {
    if (!p) return '$0';
    return '$' + Number(p).toLocaleString('es-CO');
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4.5rem)] -m-3 md:-m-6 bg-gray-50 dark:bg-gray-900 overflow-hidden font-sans">
      {/* Header bar */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 shrink-0 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 text-white rounded-xl shadow-sm">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Facebook Marketplace</h1>
              {workerStatus?.worker?.session === 'ok' ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Worker VM Activo
                </span>
              ) : workerStatus?.worker?.session === 'needs_login' ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  Requiere Login FB
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  Worker en espera
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Control de publicaciones, bajas en Facebook y atención a interesados
            </p>
          </div>
        </div>

        {/* Action Controls & Navigation Tabs */}
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('listings')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'listings'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Publicaciones ({activeApartments.filter(a => a.isPublished).length})
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'chat'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Bandeja de Interesados
              {leads.filter(l => l.status === 'nuevo').length > 0 && (
                <span className="px-1.5 py-0.2 bg-blue-600 text-white rounded-full text-[10px] font-bold">
                  {leads.filter(l => l.status === 'nuevo').length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'logs'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Logs / Diagnóstico
            </button>
          </div>

          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Refrescar datos"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-500">Cargando estado de Marketplace...</p>
            </div>
          </div>
        ) : activeTab === 'listings' ? (
          /* TAB 1: LISTINGS MANAGEMENT */
          <div className="h-full overflow-y-auto p-4 md:p-6 space-y-6">
            {/* Metrics cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <span className="text-xs font-medium text-gray-500">Total Propiedades</span>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{apartments.length}</p>
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Publicadas en Facebook</span>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {activeApartments.filter(a => a.isPublished).length}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Pausadas / Archivadas</span>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                  {activeApartments.filter(a => a.isPaused || a.isArchived).length}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Prospectos Activos</span>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{leads.length}</p>
              </div>
            </div>

            {/* Listings Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeApartments.map(apt => {
                const photos = Array.isArray(apt.photos) ? apt.photos : [];
                const photoSrc = photos[0]?.url || photos[0]?.path || (photos[0]?.data ? `data:image/jpeg;base64,${photos[0].data}` : null);
                const isOp = actionLoading[apt.id];

                return (
                  <div
                    key={apt.id}
                    className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden flex flex-col hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                  >
                    {/* Thumbnail & Badges */}
                    <div className="relative h-44 bg-gray-100 dark:bg-gray-700">
                      {photoSrc ? (
                        <img src={photoSrc} alt={apt.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <Building className="w-12 h-12" />
                        </div>
                      )}
                      <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                        {apt.isPublished ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-600 text-white shadow-sm">
                            <CheckCircle2 className="w-3.5 h-3.5" /> En Marketplace
                          </span>
                        ) : apt.isPaused ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500 text-white shadow-sm">
                            <PauseCircle className="w-3.5 h-3.5" /> Pausado
                          </span>
                        ) : apt.isArchived ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-600 text-white shadow-sm">
                            <Archive className="w-3.5 h-3.5" /> Archivado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-600 text-white shadow-sm">
                            Disponible
                          </span>
                        )}

                        {apt.activeJob && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-600 text-white animate-pulse">
                            <Clock className="w-3 h-3" /> Procesando
                          </span>
                        )}
                      </div>

                      <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-sm text-white px-2.5 py-1 rounded-lg text-xs font-bold">
                        {formatPrice(apt.monthlyRent)}/mes
                      </div>
                    </div>

                    {/* Details */}
                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white text-base">
                          {apt.name || `Apartamento ${apt.id}`}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
                          {apt.marketplaceAddress || apt.address || 'Barranquilla, Atlántico'}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-300 mt-2">
                          <span>{apt.rooms || 0} habs</span>
                          <span>•</span>
                          <span>{apt.bathrooms || 0} baños</span>
                          <span>•</span>
                          <span>{apt.area || 0} m²</span>
                        </div>

                        {apt.marketplaceUrl && (
                          <a
                            href={apt.marketplaceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium mt-2 hover:underline"
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> Ver en Facebook Marketplace
                          </a>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="pt-3 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-2">
                        {apt.isPublished ? (
                          <>
                            <button
                              onClick={() => handleAction(apt.id, 'pause')}
                              disabled={Boolean(isOp)}
                              className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-amber-300 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
                            >
                              <PauseCircle className="w-3.5 h-3.5" /> Pausar
                            </button>
                            <button
                              onClick={() => handleAction(apt.id, 'archive')}
                              disabled={Boolean(isOp)}
                              className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                            >
                              <Archive className="w-3.5 h-3.5" /> Archivar
                            </button>
                            <button
                              onClick={() => setConfirmDeleteApt(apt)}
                              disabled={Boolean(isOp)}
                              className="inline-flex items-center justify-center p-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Eliminar de Facebook"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleAction(apt.id, 'publish')}
                              disabled={Boolean(isOp)}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
                            >
                              <Sparkles className="w-3.5 h-3.5" /> Publicar en FB
                            </button>
                            {apt.marketplaceStatus === 'paused' && (
                              <button
                                onClick={() => handleAction(apt.id, 'publish')}
                                disabled={Boolean(isOp)}
                                className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors"
                              >
                                Reanudar
                              </button>
                            )}
                          </>
                        )}

                        {apt.lastJob && (
                          <button
                            onClick={() => handleViewLogs(apt.lastJob)}
                            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            title="Ver registros de automatización"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : activeTab === 'chat' ? (
          /* TAB 2: INBOX & LEADS CHAT (WHATSAPP/MESSENGER STYLE) */
          <div className="h-full flex divide-x divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
            {/* Left Sidebar: Leads List */}
            <div className="w-80 md:w-96 flex flex-col h-full bg-white dark:bg-gray-800 shrink-0">
              {/* Search & Actions */}
              <div className="p-3 border-b border-gray-200 dark:border-gray-700 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-white">Interesados ({filteredLeads.length})</h2>
                  <button
                    onClick={() => setShowNewLeadModal(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Nuevo
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Buscar por nombre, teléfono..."
                    value={leadSearch}
                    onChange={(e) => setLeadSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2">
                  <select
                    value={filterApartmentId}
                    onChange={(e) => setFilterApartmentId(e.target.value)}
                    className="w-1/2 text-xs py-1 px-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                  >
                    <option value="all">Todos los Aptos</option>
                    {apartments.map(a => (
                      <option key={a.id} value={a.id}>{a.name || a.id}</option>
                    ))}
                  </select>

                  <select
                    value={filterLeadStatus}
                    onChange={(e) => setFilterLeadStatus(e.target.value)}
                    className="w-1/2 text-xs py-1 px-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                  >
                    <option value="all">Todos Estados</option>
                    <option value="nuevo">Nuevo</option>
                    <option value="en_conversacion">En conversación</option>
                    <option value="visita_agendada">Visita agendada</option>
                    <option value="alquilado">Alquilado</option>
                    <option value="descartado">Descartado</option>
                  </select>
                </div>
              </div>

              {/* Leads scrollable list */}
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50">
                {filteredLeads.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-xs">
                    No hay prospectos que coincidan.
                  </div>
                ) : (
                  filteredLeads.map(lead => {
                    const isSelected = selectedLead?.id === lead.id;
                    const msgs = Array.isArray(lead.messages) ? lead.messages : [];
                    const lastMsg = msgs[msgs.length - 1];

                    return (
                      <div
                        key={lead.id}
                        onClick={() => setSelectedLeadId(lead.id)}
                        className={`p-3 cursor-pointer transition-colors flex items-start gap-3 ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-600'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold text-sm shrink-0">
                          {lead.name ? lead.name.charAt(0).toUpperCase() : 'P'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-gray-900 dark:text-white truncate">
                              {lead.name}
                            </h4>
                            <span className="text-[10px] text-gray-400">
                              {formatTime(lastMsg?.timestamp || lead.updatedAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {lead.apartmentName && (
                              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 truncate">
                                {lead.apartmentName}
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                              lead.status === 'nuevo' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' :
                              lead.status === 'visita_agendada' ? 'bg-emerald-100 text-emerald-800' :
                              'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {lead.status}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">
                            {lastMsg ? (lastMsg.sender === 'admin' ? 'Tú: ' : '') + lastMsg.text : (lead.notes || 'Inició conversación sobre el arriendo.')}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Pane: Active Chat Conversation */}
            {selectedLead ? (
              <div className="flex-1 flex flex-col h-full bg-gray-50/50 dark:bg-gray-900/50">
                {/* Chat Header */}
                <div className="p-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
                      {selectedLead.name ? selectedLead.name.charAt(0).toUpperCase() : 'P'}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        {selectedLead.name}
                        {selectedLead.phone && (
                          <span className="text-xs font-normal text-gray-500 flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {selectedLead.phone}
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                        Interesado en: {selectedLead.apartmentName || 'Apartamento sin asignar'}
                      </p>
                    </div>
                  </div>

                  {/* Lead status dropdown */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Estado:</span>
                    <select
                      value={selectedLead.status || 'nuevo'}
                      onChange={(e) => handleUpdateStatus(selectedLead.id, e.target.value)}
                      className="text-xs py-1 px-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none"
                    >
                      <option value="nuevo">Nuevo</option>
                      <option value="en_conversacion">En conversación</option>
                      <option value="visita_agendada">Visita agendada</option>
                      <option value="alquilado">Alquilado</option>
                      <option value="descartado">Descartado</option>
                    </select>
                  </div>
                </div>

                {/* Messages Feed */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {/* Lead Initial Info Banner */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-xl p-3 text-xs text-blue-900 dark:text-blue-200">
                    <p className="font-semibold">Prospecto de Facebook Marketplace</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-0.5">
                      Interesado en {selectedLead.apartmentName}. Puedes responderle directamente desde este panel.
                    </p>
                  </div>

                  {Array.isArray(selectedLead.messages) && selectedLead.messages.map((msg, i) => {
                    const isAdmin = msg.sender === 'admin';
                    return (
                      <div
                        key={msg.id || i}
                        className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-xs shadow-sm ${
                            isAdmin
                              ? 'bg-blue-600 text-white rounded-tr-none'
                              : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-tl-none'
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.text}</p>
                          <span className={`block text-[10px] mt-1 text-right ${isAdmin ? 'text-blue-100' : 'text-gray-400'}`}>
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>

                {/* Quick replies & Message Composer */}
                <div className="p-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 space-y-2">
                  {/* Quick templates pills */}
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    <button
                      onClick={() => setChatInput('¡Hola! Sí, el apartamento sigue disponible para entrega inmediata. ¿Cuándo te gustaría visitarlo?')}
                      className="px-2 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-md text-gray-600 dark:text-gray-300 transition-colors"
                    >
                      ¿Sigue disponible?
                    </button>
                    <button
                      onClick={() => setChatInput('Para el arriendo solicitamos: cédula de ciudadanía, comprobante de ingresos (desprendibles o extractos bancarios) y un codeudor.')}
                      className="px-2 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-md text-gray-600 dark:text-gray-300 transition-colors"
                    >
                      Requisitos de arriendo
                    </button>
                    <button
                      onClick={() => setChatInput('Con gusto podemos coordinar una visita presencial hoy o mañana. ¿En qué horario te queda mejor?')}
                      className="px-2 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-md text-gray-600 dark:text-gray-300 transition-colors"
                    >
                      Agendar visita
                    </button>
                  </div>

                  <form onSubmit={handleSendReply} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Escribe una respuesta para el prospecto..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim()}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      <Send className="w-3.5 h-3.5" /> Enviar
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-xs">
                Selecciona un prospecto para ver y responder mensajes.
              </div>
            )}
          </div>
        ) : (
          /* TAB 3: WORKER LOGS & ACTIVITY */
          <div className="h-full overflow-y-auto p-4 md:p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              Historial de Automatización en Facebook Marketplace
            </h2>

            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 font-semibold border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="p-3">ID</th>
                    <th className="p-3">Apartamento</th>
                    <th className="p-3">Acción</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Enlace / Mensaje</th>
                    <th className="p-3">Fecha</th>
                    <th className="p-3 text-right">Detalles</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {jobs.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="p-4 text-center text-gray-400">
                        No hay trabajos registrados todavía.
                      </td>
                    </tr>
                  ) : (
                    jobs.map(job => (
                      <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="p-3 font-mono font-medium text-gray-600 dark:text-gray-300">#{job.id}</td>
                        <td className="p-3 font-bold text-gray-900 dark:text-white">{job.apartmentName}</td>
                        <td className="p-3">
                          <span className="font-mono px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                            {job.action || (job.publish ? 'publish' : 'manage')}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
                            job.status === 'published' ? 'bg-emerald-100 text-emerald-800' :
                            job.status === 'processing' ? 'bg-blue-100 text-blue-800 animate-pulse' :
                            job.status === 'deleted' ? 'bg-red-100 text-red-800' :
                            job.status === 'paused' ? 'bg-amber-100 text-amber-800' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-300 max-w-xs truncate">
                          {job.listingUrl ? (
                            <a href={job.listingUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> {job.listingUrl}
                            </a>
                          ) : (
                            job.message || 'Sin mensaje'
                          )}
                        </td>
                        <td className="p-3 text-gray-400 font-mono">
                          {new Date(job.createdAt).toLocaleString('es-CO')}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleViewLogs(job)}
                            className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                          >
                            Ver traza
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: Confirm Delete Listing */}
      {confirmDeleteApt && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-gray-700 space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                ¿Eliminar publicación de Facebook?
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Esto encolará un comando en la VM para retirar la publicación de <strong>{confirmDeleteApt.name}</strong> de Facebook Marketplace.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmDeleteApt(null)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleAction(confirmDeleteApt.id, 'delete')}
                className="flex-1 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-sm"
              >
                Confirmar Eliminación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: View Execution Logs */}
      {selectedJobLogs && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-gray-200 dark:border-gray-700 space-y-4 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Trazas de Automatización: Trabajo #{selectedJobLogs.id} ({selectedJobLogs.apartmentName})
              </h3>
              <button onClick={() => setSelectedJobLogs(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 font-mono text-xs">
              {loadingLogs ? (
                <div className="p-4 text-center text-gray-400">Cargando registros...</div>
              ) : jobLogsData.length === 0 ? (
                <div className="p-4 text-center text-gray-400">Sin logs detallados para este trabajo.</div>
              ) : (
                jobLogsData.map((log, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center justify-between text-[11px] text-gray-400">
                      <span className="font-semibold text-blue-600 dark:text-blue-400">[{log.stage}]</span>
                      <span>{new Date(log.createdAt || log.timestamp || 0).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-gray-800 dark:text-gray-200 mt-1">{log.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Create Lead Manually */}
      {showNewLeadModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateLead} className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-gray-700 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Registrar Nuevo Prospecto</h3>
              <button type="button" onClick={() => setShowNewLeadModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Laura Martínez"
                  value={newLeadForm.name}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Teléfono / WhatsApp</label>
                <input
                  type="text"
                  placeholder="Ej: 300 123 4567"
                  value={newLeadForm.phone}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, phone: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Apartamento de Interés</label>
                <select
                  value={newLeadForm.apartmentId}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, apartmentId: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">Selecciona un apartamento</option>
                  {apartments.map(a => (
                    <option key={a.id} value={a.id}>{a.name || a.id} ({formatPrice(a.monthlyRent)})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Primer Mensaje o Consulta</label>
                <textarea
                  rows="2"
                  placeholder="Ej: Preguntó por Marketplace si acepta mascotas pequeñas..."
                  value={newLeadForm.message}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, message: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewLeadModal(false)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
              >
                Guardar Prospecto
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
