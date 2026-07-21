import { useEffect } from 'react';
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
import { refreshAllFromServer, startCloudPolling } from './api';
import { initDarkMode } from './utils/darkMode';
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
  useEffect(() => {
    try { initDB(); } catch (e) { console.error('DB init error:', e); }
    requestNotificationPermission();
    // Fetch ALL data from server on startup (cloud-first)
    (async function startup() {
      for (let i = 0; i < 3; i++) {
        try {
          const ok = await refreshAllFromServer();
          if (ok) { console.log('Cloud startup OK'); break; }
        } catch (e) { console.warn('Cloud startup attempt ' + (i+1) + ' failed'); }
        if (i < 2) await new Promise(r => setTimeout(r, 5000));
      }
      // Start polling for changes from other PCs
      startCloudPolling(15000);
    })();
    try { initDarkMode(); } catch (e) { console.error('Dark mode init error:', e); }
  }, []);

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
