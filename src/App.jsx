import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initDB } from './db/database';
import Layout from './components/Layout';
import VersionBanner from './components/VersionBanner';
import Dashboard from './pages/Dashboard';
import Apartments from './pages/Apartments';
import ApartmentDetail from './pages/ApartmentDetail';
import Tenants from './pages/Tenants';
import Contracts from './pages/Contracts';
import Payments from './pages/Payments';
import Utilities from './pages/Utilities';
import Reports from './pages/Reports';
import ShareApartments from './pages/ShareApartments';
import ContractGenerator from './pages/ContractGenerator';
import Settings from './pages/Settings';
import Chat from './pages/Chat';
import PublicApartments from './pages/PublicApartments';
import Login from './pages/Login';
import MiApto from './pages/MiApto';
import { requestNotificationPermission } from './utils/notifications';
import { refreshAllFromServer, startCloudPolling, startDataVersionPolling } from './api';
import { initDarkMode } from './utils/darkMode';
import { initTheme, loadThemeFromServer } from './utils/theme';
import { getAuth } from './utils/auth';

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

export default function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try { initDB(); } catch (e) { console.error('DB init error:', e); }
    requestNotificationPermission();
    // Fetch ALL data from server on startup (cloud-first)
    (async function startup() {
      for (let i = 0; i < 3; i++) {
        try {
          const ok = await refreshAllFromServer();
          if (ok) { break; }
        } catch (e) { console.warn('Cloud startup attempt ' + (i+1) + ' failed'); }
        if (i < 2) await new Promise(r => setTimeout(r, 5000));
      }
      setLoading(false);
      // Start polling for changes from other PCs
      startCloudPolling(15000);
      // Auto-reload cuando otro cliente hace cambios
      startDataVersionPolling(3000);
      // Load theme preference from server
      try { await loadThemeFromServer(); } catch (e) { /* ignore */ }
    })();
    try { initDarkMode(); } catch (e) { console.error('Dark mode init error:', e); }
    try { initTheme(); } catch (e) { console.error('Theme init error:', e); }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-500">Cargando datos del servidor...</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/mi-apto" element={<MiApto />} />
        <Route path="/publico" element={<PublicApartments />} />
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
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/share" element={<ShareApartments />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/generate-contract" element={<ContractGenerator />} />
                  <Route path="/generate-contract/:id" element={<ContractGenerator />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
                <VersionBanner />
              </Layout>
            </AdminRoute>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}
