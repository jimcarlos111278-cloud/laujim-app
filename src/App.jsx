import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { initDB } from './db/database';
import { isCapacitor } from './utils/config';
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
import { requestNotificationPermission } from './utils/notifications';
import { api, refreshAllFromServer, startCloudPolling, startDataVersionPolling } from './api';
import { initTheme, loadThemeFromServer } from './utils/theme';
import { getAuth } from './utils/auth';
import { syncAuthorizedCallerNumbers } from './utils/callScreening';

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

  useEffect(() => {
    try { initDB(); } catch (e) { console.error('DB init error:', e); }
    const auth = getAuth();
    if (!auth || auth.role !== 'admin') {
      setLoading(false);
      try { initTheme(); } catch (e) { console.error('Theme init error:', e); }
      return;
    }
    requestNotificationPermission();
    const syncCallScreening = async () => {
      try { await syncAuthorizedCallerNumbers(await api.tenants.toArray()); } catch (e) { console.warn('Call screening sync failed'); }
    };
    // Fetch ALL data from server on startup (cloud-first)
    (async function startup() {
      for (let i = 0; i < 3; i++) {
        try {
          const ok = await refreshAllFromServer();
          if (ok) { break; }
        } catch (e) { console.warn('Cloud startup attempt ' + (i+1) + ' failed'); }
        if (i < 2) await new Promise(r => setTimeout(r, 5000));
      }
      await syncCallScreening();
      setLoading(false);
      // Start polling for changes from other PCs
      startCloudPolling(15000);
      // Auto-reload cuando otro cliente hace cambios
      startDataVersionPolling(3000);
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
                <VersionBanner />
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
