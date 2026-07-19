const STORAGE_KEY = 'laujim-dark-mode';

export function isDarkMode() {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function toggleDarkMode() {
  const next = !isDarkMode();
  localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
  applyDarkMode(next);
  return next;
}

export function initDarkMode() {
  applyDarkMode(isDarkMode());
}

export function applyDarkMode(enabled) {
  if (enabled) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}
