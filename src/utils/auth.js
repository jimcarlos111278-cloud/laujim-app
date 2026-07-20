const STORAGE_KEY = 'apt_auth';

export function getAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setAuth(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isAdmin() {
  const a = getAuth();
  return a?.role === 'admin';
}

export function isTenant() {
  const a = getAuth();
  return a?.role === 'tenant';
}

export function getTenantApartmentId() {
  const a = getAuth();
  return a?.role === 'tenant' ? a.apartmentId : null;
}

export function requireAuth() {
  const a = getAuth();
  if (!a) return { redirect: '/login' };
  return null;
}

export async function loginAdmin(username, password) {
  if (username === 'admin' && password === 'laujim123') {
    setAuth({ role: 'admin', username: 'admin', name: 'Administrador' });
    return { ok: true, role: 'admin' };
  }
  return { ok: false, error: 'Credenciales inválidas' };
}

export async function loginTenant(aptName, password) {
  const { default: db } = await import('../db/database');
  const apartments = await db.apartments.toArray();
  const apt = apartments.find(a => a.name === aptName || String(a.id) === aptName);
  if (!apt) return { ok: false, error: 'Apartamento no encontrado' };
  const passwords = await db.passwords.toArray();
  const record = passwords.find(p => p.apartmentId === apt.id);
  if (!record || record.password !== password) return { ok: false, error: 'Contraseña incorrecta' };
  const tenants = await db.tenants.toArray();
  const contracts = await db.contracts.toArray();
  const contract = contracts.find(c => c.apartmentId === apt.id && (!c.endDate || new Date(c.endDate) > new Date()));
  const tenant = contract ? tenants.find(t => t.id === contract.tenantId) : null;
  setAuth({ role: 'tenant', apartmentId: apt.id, name: tenant?.name || apt.name, username: apt.name });
  return { ok: true, role: 'tenant', apartmentId: apt.id };
}
