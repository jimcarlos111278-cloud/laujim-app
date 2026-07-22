const STORAGE_KEY = 'laujim-theme';

export const THEMES = [
  { id: 'claro',   label: 'Claro',    color: '#ffffff',  bg: '#f3f4f6',    textColor: '#111827',  icon: 'Sun' },
  { id: 'oscuro',  label: 'Oscuro',   color: '#1f2937',  bg: '#111827',    textColor: '#ffffff',  icon: 'Moon' },
  { id: 'rosa',    label: 'Rosa',     color: '#ec4899',  bg: '#fdf2f8',    textColor: '#831843',  icon: 'Palette' },
  { id: 'verde',   label: 'Verde',    color: '#10b981',  bg: '#ecfdf5',    textColor: '#064e3b',  icon: 'Palette' },
  { id: 'azul',    label: 'Azul',     color: '#0ea5e9',  bg: '#f0f9ff',    textColor: '#0c4a6e',  icon: 'Palette' },
];

const themeMap = Object.fromEntries(THEMES.map(t => [t.id, t]));

export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'claro';
}

export function getThemeInfo(id) {
  return themeMap[id] || themeMap.claro;
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
  const doc = document.documentElement;
  doc.classList.remove(...THEMES.map(t => 'theme-' + t.id));
  if (id === 'oscuro') {
    doc.classList.add('dark');
    doc.classList.add('theme-oscuro');
  } else {
    doc.classList.remove('dark');
    if (id !== 'claro') doc.classList.add('theme-' + id);
  }
}

async function syncThemeToServer(id) {
  try {
    const { api } = await import('../api');
    const all = await api.users.toArray();
    const target = all.find(u => u.role === 'admin') || all[0];
    if (target) await api.users.update(target.id, { theme: id });
  } catch (e) {
    console.warn('Could not sync theme to server:', e);
  }
}

export async function loadThemeFromServer() {
  try {
    const { api } = await import('../api');
    const all = await api.users.toArray();
    const target = all.find(u => u.role === 'admin') || all[0];
    if (target && target.theme && themeMap[target.theme]) {
      setTheme(target.theme, false);
      return target.theme;
    }
  } catch {}
  return getTheme();
}