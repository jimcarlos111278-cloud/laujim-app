const KEY = 'view-mode';
export function getViewMode() {
  return localStorage.getItem(KEY) || 'horizontal';
}
export function setViewMode(mode) {
  localStorage.setItem(KEY, mode);
}
