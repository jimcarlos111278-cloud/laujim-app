import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Users, FileText, DollarSign, Zap, BarChart3, Settings, Menu, X, Home, Share2, ScrollText, Cloud, CloudOff, MessageCircle, Plus, Minus, Type
} from 'lucide-react';
import { isServerAvailable } from '../utils/sync';
import { isCapacitor } from '../utils/config';
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
  const appMode = isCapacitor() || window.innerWidth < 900;
  const [sidebarOpen, setSidebarOpen] = useState(appMode);

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

  const toggleSidebar = () => { if (!appMode) setSidebarOpen(prev => !prev); };

  const [fontScale, setFontScale] = useState(() => Number(localStorage.getItem('font-scale') || 1));
  function changeFontSize(delta) {
    const next = Math.max(0.7, Math.min(1.5, fontScale + delta));
    setFontScale(next);
    localStorage.setItem('font-scale', String(next));
    document.documentElement.style.setProperty('--font-scale', next);
  }
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', fontScale);
  }, []);

  return (
    <div className={`flex h-screen bg-gray-100 dark:bg-gray-900 ${appMode ? 'app-layout' : ''}`}>
      {!appMode && <div className={`fixed inset-0 bg-black/50 z-20 lg:hidden ${sidebarOpen ? 'block' : 'hidden'}`} onClick={() => setSidebarOpen(false)} />}
      <aside className={`${appMode ? 'w-44 shrink-0 static' : 'w-64 fixed'} top-0 left-0 z-30 h-full bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-200 ${
        appMode ? 'translate-x-0' : `lg:translate-x-0 lg:static lg:z-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
      }`}>
        <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Home className={`${appMode ? 'w-4 h-4' : 'w-6 h-6'} text-blue-600`} />
            <span className={`font-bold ${appMode ? 'text-sm' : 'text-lg'} text-gray-900 dark:text-white`}>Gestión Aptos</span>
          </div>
          {!appMode && <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <X className="w-5 h-5" />
          </button>}
        </div>
        <nav className={`${appMode ? 'p-1.5 space-y-0.5' : 'p-3 space-y-1'}`}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg font-medium transition-colors ${
                  appMode ? 'px-2 py-1.5 text-xs' : `${item.sub ? 'pl-9 pr-3 py-2 text-xs' : 'px-3 py-2.5 text-sm'}`
                } ${isActive ? 'nav-active' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'}`
              }
              onClick={() => { if (!appMode) setSidebarOpen(false); }}
            >
              <item.icon className={`${appMode ? 'w-3.5 h-3.5' : item.sub ? 'w-4 h-4' : 'w-5 h-5'}`} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={`${appMode ? 'p-1.5' : 'absolute bottom-0 left-0 right-0 p-3 border-t border-gray-200 dark:border-gray-700'} space-y-1.5`}>
          <div className={`flex items-center justify-center gap-1 ${appMode ? 'text-xs' : ''}`}>
            <button onClick={() => changeFontSize(-0.1)} className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${appMode ? '' : 'text-sm'}`} title="Reducir tamaño">
              <Minus className={`${appMode ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
            </button>
            <Type className={`${appMode ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-gray-400`} />
            <span className={`text-xs text-gray-400 ${appMode ? 'text-[10px]' : ''}`}>{Math.round(fontScale * 100)}%</span>
            <button onClick={() => changeFontSize(0.1)} className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${appMode ? '' : 'text-sm'}`} title="Aumentar tamaño">
              <Plus className={`${appMode ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
            </button>
          </div>
          {!appMode && <div className="flex justify-center"><ThemeSelector /></div>}
          <div className={`flex items-center justify-center gap-2 ${appMode ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>
            {connected === null && <span className="text-gray-400">Verificando...</span>}
            {connected === true && <><Cloud className={`${appMode ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-green-500`} /><span className="text-green-600">En línea</span></>}
            {connected === false && <><CloudOff className={`${appMode ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-red-500`} /><span className="text-red-500">Sin conexión</span></>}
          </div>
        </div>}
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        {!appMode && <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3 lg:hidden">
          <button onClick={toggleSidebar} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <Home className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-gray-900 dark:text-white">Gestión Aptos</span>
          </div>
        </header>}
        <main className="flex-1 overflow-auto p-3 md:p-6" style={{ zoom: fontScale }}>
          {children}
        </main>
      </div>
    </div>
  );
}
