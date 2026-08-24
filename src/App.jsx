import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { initDB } from './db/database';
import { getBase, isCapacitor } from './utils/config';
import Layout from './components/Layout';
import VersionBanner from './components/VersionBanner';
import Dashboard from './pages/Dashboard';
import Apartments from './pages/Apartments';
import ApartmentDetail from './pages/ApartmentDetail';
import Tenants from './pages/Tenants';

import Contracts from './pages/Contracts';
import Payments from './pages/Payments';
import Utilities from './pages/Utilities';
import ScraperWorker from './pages/ScraperWorker';
import Reports from './pages/Reports';
import Predial from './pages/Predial';
import ShareApartments from './pages/ShareApartments';
import ContractGenerator from './pages/ContractGenerator';
import Settings from './pages/Settings';
import WhatsAppInbox from './pages/WhatsAppInbox';
import WhatsAppContacts from './pages/WhatsAppContacts';
import PublicApartments from './pages/PublicApartments';
import PublicApartment from './pages/PublicApartment';
import Login from './pages/Login';
import MiApto from './pages/MiApto';
import SecurityCenter from './pages/SecurityCenter';
import Onboarding from './pages/Onboarding';
import { requestNotificationPermission } from './utils/notifications';
import { api, getCloudSyncStatus, refreshAllFromServer, startCloudPolling, startDataVersionPolling } from './api';
import { initTheme, loadThemeFromServer } from './utils/theme';
import { clearAuth, getAuth } from './utils/auth';
import { syncAuthorizedCallerNumbers } from './utils/callScreening';
import { clearAppData } from './utils/resetApp';
import { configureBackgroundNotifications, stopBackgroundNotifications } from './utils/backgroundNotifications';
import { getNotifConfig } from './utils/localNotifications';

function ProtectedRoute({ children }) {
  const auth = getAuth();
  if (!auth) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const auth = getAuth();
  if (!auth) return <Navigate to="/login" replace />;
  if (auth.role !== 'admin') return <Navigate to="/mi-apto" replace />;
  return children;
}

function PrivateApp() {
  const [loading, setLoading] = useState(true);
  const [cloudError, setCloudError] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const openWhatsAppConversation = event => {
      const conversationId = Number(event?.detail?.conversationId || window.__laujimPendingConversation || 0);
      if (!conversationId) return;
      delete window.__laujimPendingConversation;
      navigate(`/whatsapp?conversation=${conversationId}`);
    };
    window.addEventListener('laujim:open-whatsapp', openWhatsAppConversation);
    if (window.__laujimPendingConversation) openWhatsAppConversation({ detail: { conversationId: window.__laujimPendingConversation } });
    return () => window.removeEventListener('laujim:open-whatsapp', openWhatsAppConversation);
  }, [navigate]);

  useEffect(() => {
    try { initDB(); } catch (e) { console.error('DB init error:', e); }
    const auth = getAuth();
    if (!auth || auth.role !== 'admin') {
      setLoading(false);
      try { initTheme(); } catch (e) { console.error('Theme init error:', e); }
      return;
    }
    requestNotificationPermission();
    const notificationConfig = getNotifConfig();
    if (notificationConfig.backgroundEnabled !== false) {
      configureBackgroundNotifications({ serverUrl: getBase(), token: auth.token, preferences: notificationConfig });
    } else {
      stopBackgroundNotifications();
    }
    const syncCallScreening = async () => {
      try { await syncAuthorizedCallerNumbers(await api.tenants.toArray()); } catch (e) { console.warn('Call screening sync failed'); }
    };
    // Fetch ALL data from server on startup (cloud-first)
    (async function startup() {
      let cloudSyncOk = false;
      let collectionsToSync = undefined;
      for (let i = 0; i < 3; i++) {
        try {
          cloudSyncOk = await refreshAllFromServer(collectionsToSync);
          if (cloudSyncOk) break;
        } catch (e) { console.warn('Cloud startup attempt ' + (i+1) + ' failed'); }
        const failedCollections = getCloudSyncStatus().failedCollections;
        collectionsToSync = failedCollections.length ? failedCollections : undefined;
        if (i < 2) await new Promise(r => setTimeout(r, 5000));
      }
      const syncStatus = getCloudSyncStatus();
      if (!cloudSyncOk && (syncStatus.status === 401 || syncStatus.status === 403)) {
        // A session can expire while the SPA stays open. Do not leave the user
        // inside an apparently valid dashboard backed by empty client arrays.
        clearAuth();
        window.location.replace('/login?reason=session-expired');
        return;
      }
      if (!cloudSyncOk) {
        setCloudError(syncStatus.status === 503
          ? 'Render está activo, pero la base de datos todavía no está lista o no responde.'
          : 'No se pudieron sincronizar los datos de la base de datos.');
      }
      setLoading(false);
      if (cloudSyncOk) {
        // Start polling for changes from other PCs
        startCloudPolling(15000);
        // Auto-reload cuando otro cliente hace cambios
        startDataVersionPolling(3000);
        // Caller screening is useful but not required to render the dashboard.
        // Run it after the first screen is available so Android does not make
        // the user wait for native contact synchronization.
        void syncCallScreening();
      }
      // Load theme preference from server
      try { await loadThemeFromServer(); } catch (e) { /* ignore */ }
    })();
    const callerSyncTimer = setInterval(syncCallScreening, 60000);
    try { initTheme(); } catch (e) { console.error('Theme init error:', e); }
    // The APK uses the same responsive layout as the web app. The previous
    // desktop-forcing class compressed narrow Android screens and made labels
    // split in the middle of words.
    document.documentElement.classList.remove('force-desktop');
    document.documentElement.classList.toggle('app-android', isCapacitor());
    return () => clearInterval(callerSyncTimer);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-c-500 mx-auto mb-4" />
          <p className="text-gray-500">Cargando datos del servidor...</p>
        </div>
      </div>
    );
  }

  if (cloudError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-lg dark:border-amber-800 dark:bg-gray-800">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">!</div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">No se cargaron los apartamentos</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{cloudError}</p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">No mostraremos 0 apartamentos como si la base estuviera vacía.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={async () => { clearAuth(); await clearAppData(); window.location.replace('/login?reset=1'); }} className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/30">Borrar datos</button>
            <button onClick={() => window.location.reload()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Reintentar conexión</button>
            <button onClick={() => { clearAuth(); window.location.replace('/login'); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">Iniciar sesión de nuevo</button>
          </div>
        </div>
      </div>
    );
  }

  return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/mi-apto" element={<MiApto />} />
        <Route path="*" element={
          <ProtectedRoute>
            <AdminRoute>
              <Layout>
                <Routes>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/apartments" element={<Apartments />} />
                  <Route path="/apartments/:id" element={<ApartmentDetail />} />
                  <Route path="/tenants" element={<Tenants />} />

                  <Route path="/contracts" element={<Contracts />} />
                  <Route path="/payments" element={<Payments />} />
                  <Route path="/utilities" element={<Utilities />} />
                  <Route path="/scraper-worker" element={<ScraperWorker />} />
                  <Route path="/security" element={<SecurityCenter />} />
                  <Route path="/onboarding" element={<Onboarding />} />
                  <Route path="/predial" element={<Predial />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/share" element={<ShareApartments />} />
                  <Route path="/generate-contract" element={<ContractGenerator />} />
                  <Route path="/generate-contract/:id" element={<ContractGenerator />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/whatsapp" element={<WhatsAppInbox />} />
                  <Route path="/whatsapp-contactos" element={<WhatsAppContacts />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
                {location.pathname !== '/whatsapp' && <VersionBanner />}
              </Layout>
            </AdminRoute>
          </ProtectedRoute>
        } />
      </Routes>
  );
}

function AppContent() {
  const location = useLocation();
  if (location.pathname === '/publico' || location.pathname.startsWith('/publico/')) {
    return (
      <Routes>
        <Route path="/publico" element={<PublicApartments />} />
        <Route path="/publico/apartamento/:id" element={<PublicApartment />} />
      </Routes>
    );
  }
  return <PrivateApp />;
}

export default function App() {
  return <BrowserRouter><AppContent /></BrowserRouter>;
}
