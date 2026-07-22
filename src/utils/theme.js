const STORAGE_KEY = 'laujim-theme';

export const THEMES = [
  { id: 'default', label: 'Azul', color: '#3b82f6', bg: '#eff6ff', darkBg: 'rgba(30, 58, 138, 0.3)' },
  { id: 'rosado', label: 'Rosado', color: '#ec4899', bg: '#fdf2f8', darkBg: 'rgba(131, 24, 67, 0.3)' },
  { id: 'verde', label: 'Verde', color: '#10b981', bg: '#ecfdf5', darkBg: 'rgba(6, 78, 59, 0.3)' },
  { id: 'azul', label: 'Celeste', color: '#0ea5e9', bg: '#f0f9ff', darkBg: 'rgba(12, 74, 110, 0.3)' },
  { id: 'amarillo', label: 'Amarillo', color: '#f59e0b', bg: '#fffbeb', darkBg: 'rgba(120, 53, 15, 0.3)' },
  { id: 'rojo', label: 'Rojo', color: '#ef4444', bg: '#fef2f2', darkBg: 'rgba(127, 29, 29, 0.3)' },
];

const themeMap = Object.fromEntries(THEMES.map(t => [t.id, t]));

export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'default';
}

export function getThemeInfo(id) {
  return themeMap[id] || themeMap.default;
}

export function setTheme(id, syncToServer) {
  localStorage.setItem(STORAGE_KEY, id);
  applyTheme(id);
  if (syncToServer) syncThemeToServer(id);
}

export function initTheme() {
  applyTheme(getTheme());
}

function applyTheme(id) {
  document.documentElement.classList.remove(...THEMES.map(t => 'theme-' + t.id));
  if (id !== 'default') document.documentElement.classList.add('theme-' + id);
}

async function syncThemeToServer(id) {
  try {
    const { api } = await import('../api');
    const admins = await api.users.where('role').equals('admin').toArray();
    if (admins.length > 0) {
      await api.users.update(admins[0].id, { theme: id });
    } else {
      const all = await api.users.toArray();
      if (all.length > 0) {
        await api.users.update(all[0].id, { theme: id });
      }
    }
  } catch (e) {
    console.warn('Could not sync theme to server:', e);
  }
}

export async function loadThemeFromServer() {
  try {
    const { api } = await import('../api');
    const admins = await api.users.where('role').equals('admin').toArray();
    if (admins.length > 0 && admins[0].theme) {
      const tid = admins[0].theme;
      if (themeMap[tid]) {
        setTheme(tid, false);
        return tid;
      }
    }
  } catch {}
  return getTheme();
}