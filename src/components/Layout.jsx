import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Users, FileText, DollarSign, Zap, BarChart3, Settings, Menu, X, Home, Share2, ScrollText, Cloud, CloudOff, MessageCircle
} from 'lucide-react';
import { isServerAvailable } from '../utils/sync';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/apartments', label: 'Apartamentos', icon: Building2 },
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connected, setConnected] = useState(null); // null=checking, true=ok, false=offline

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

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <div className={`fixed inset-0 bg-black/50 z-20 lg:hidden ${sidebarOpen ? 'block' : 'hidden'}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`fixed top-0 left-0 z-30 h-full w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Home className="w-6 h-6 text-blue-600" />
            <span className="font-bold text-lg text-gray-900 dark:text-white">Gestión Aptos</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="p-3 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                }`
              }
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            {connected === null && <span className="text-xs text-gray-400">Verificando conexión...</span>}
            {connected === true && <><Cloud className="w-4 h-4 text-green-500" /><span className="text-xs text-green-600">En línea</span></>}
            {connected === false && <><CloudOff className="w-4 h-4 text-red-500" /><span className="text-xs text-red-500">Sin conexión</span></>}
          </div>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <Home className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-gray-900 dark:text-white">Gestión Aptos</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
