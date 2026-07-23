import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Users, FileText, DollarSign, Zap, BarChart3, Settings, Menu, X, Home, Share2, ScrollText, Cloud, CloudOff, MessageCircle, Plus, Minus, Type
} from 'lucide-react';
import { isServerAvailable } from '../utils/sync';
import ThemeSelector from './ThemeSelector';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/apartments', label: 'Apartamentos', icon: Building2 },
  { to: '/predial', label: 'Impuesto predial', icon: Building2, sub: true },
  { to: '/tenants', label: 'Inquilinos', icon: Users },

  { to: '/contracts', label: 'Contratos', icon: FileText },
  { to: '/generate-contract', label: 'Generar Contrato', icon: ScrollText },
  { to: '/payments', label: 'Pagos', icon: DollarSign },
  { to: '/chat', label: 'Chat', icon: MessageCircle },
  { to: '/utilities', label: 'Servicios Públicos', icon: Zap },
  { to: '/share', label: 'Compartir', icon: Share2 },
  { to: '/reports', label: 'Reportes', icon: BarChart3 },
  { to: '/settings', label: 'Configuración', icon: Settings },
];

export default function Layout({ children }) {
  const [connected, setConnected] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fontScale, setFontScale] = useState(() => Number(localStorage.getItem('font-scale') || 1));
  const location = useLocation();

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  useEffect(() => {
    const check = async () => {
      const s = await isServerAvailable();
      setConnected(s.ok);
    };
    check();
    const iv = setInterval(check, 15000);
    window.addEventListener('focus', check);
    return () => { clearInterval(iv); window.removeEventListener('focus', check); };
  }, []);

  function changeFontSize(delta) {
    const next = Math.max(0.5, Math.min(2.0, fontScale + delta));
    setFontScale(next);
    localStorage.setItem('font-scale', String(next));
    document.documentElement.style.setProperty('--font-scale', next);
  }
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', fontScale);
  }, []);

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900 overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20" onClick={() => setSidebarOpen(false)} />
      )}
      <aside style={{ zoom: fontScale }} className={`fixed top-0 left-0 z-30 h-full w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-200 flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <Home className="w-5 h-5 text-blue-600" />
            <span className="font-bold text-base text-gray-900 dark:text-white">Gestión Aptos</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="p-3 space-y-1 flex-1 overflow-auto">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg font-medium transition-colors ${
                  item.sub ? 'pl-9 pr-3 py-2 text-xs' : 'px-3 py-2.5 text-sm'
                } ${isActive ? 'nav-active' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'}`
              }
            >
              <item.icon className={`${item.sub ? 'w-4 h-4' : 'w-5 h-5'}`} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 space-y-1.5 shrink-0">
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => changeFontSize(-0.1)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Reducir tamaño">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <Type className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-400">{Math.round(fontScale * 100)}%</span>
            <button onClick={() => changeFontSize(0.1)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Aumentar tamaño">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex justify-center"><ThemeSelector /></div>
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {connected === null && <span className="text-gray-400">Verificando...</span>}
            {connected === true && <><Cloud className="w-3.5 h-3.5 text-green-500" /><span className="text-green-600">En línea</span></>}
            {connected === false && <><CloudOff className="w-3.5 h-3.5 text-red-500" /><span className="text-red-500">Sin conexión</span></>}
          </div>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <Home className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-gray-900 dark:text-white">Gestión Aptos</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-3 md:p-6" style={{ zoom: fontScale }}>
          {children}
        </main>
      </div>
    </div>
  );
}
