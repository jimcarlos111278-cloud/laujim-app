import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initDB } from './db/database';
import db from './db/database';
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
import { startAutoSync, restoreAllFromBackup, syncPull } from './utils/sync';
import { syncAndGenerateReminders } from './utils/calendar';
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
    try { restoreAllFromBackup(); } catch (e) { console.error('Backup restore error:', e); }
    try { requestNotificationPermission(); } catch (e) { console.error('Notification error:', e); }
    // Sync from server on startup with retries
    (async function startupSync() {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await syncPull();
          if (r.ok) { console.log('Startup sync OK'); break; }
          console.warn('Startup sync attempt ' + (i+1) + ' failed:', r.reason);
        } catch (e) { console.warn('Startup sync attempt ' + (i+1) + ' error:', e); }
        if (i < 2) await new Promise(r => setTimeout(r, 5000));
      }
    })();
    try {
      startAutoSync(30000, async () => {
        const ok = window.confirm('Se detectaron cambios en los pagos.\n¿Desea generar recordatorios de calendario para todos los apartamentos?');
        if (ok) {
          try {
            const apartments = await db.apartments.toArray();
            syncAndGenerateReminders(apartments);
          } catch (e) { console.error('Error generating reminders:', e); }
        }
      });
    } catch (e) { console.error('Sync error:', e); }
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
