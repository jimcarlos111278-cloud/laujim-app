const BASE_URL = process.env.API_BASE_URL || 'http://localhost:1011/api';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'laujim laujim';
const TIMEOUT = 8000;

function headers() {
  return { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN };
}

function signal() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(TIMEOUT) : undefined;
}

export async function login(apto, cedula) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: String(apto), password: String(cedula) }),
    signal: signal(),
  });
  return res.json();
}

export async function getApartmentByName(name) {
  const res = await fetch(`${BASE_URL}/apartments/first/name/${encodeURIComponent(String(name))}`, {
    headers: headers(),
    signal: signal(),
  });
  return res.json();
}

export async function getTenantByPhone(phone) {
  const res = await fetch(`${BASE_URL}/tenants/first/phone/${encodeURIComponent(String(phone))}`, {
    headers: headers(),
    signal: signal(),
  });
  return res.json();
}

export async function getSettings() {
  const res = await fetch(`${BASE_URL}/settings`, { headers: headers(), signal: signal() });
  return res.json().catch(() => []);
}

export async function updateSetting(key, value) {
  const all = await getSettings();
  const existing = all.find(s => s.key === key);
  if (existing) {
    await fetch(`${BASE_URL}/settings/${existing.id}`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ ...existing, value }),
      signal: signal(),
    });
  } else {
    await fetch(`${BASE_URL}/settings`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ key, value }),
      signal: signal(),
    });
  }
}

export async function getVacants() {
  const res = await fetch(`${BASE_URL}/public/vacants`, { headers: headers(), signal: signal() });
  return res.json();
}

export async function getAllApartments() {
  const res = await fetch(`${BASE_URL}/apartments`, { headers: headers(), signal: signal() });
  return res.json().catch(() => []);
}

export async function submitLead(data) {
  const res = await fetch(`${BASE_URL}/leads`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify(data),
    signal: signal(),
  });
  return res.json();
}

export async function getLeads() {
  const res = await fetch(`${BASE_URL}/leads`, { headers: headers(), signal: signal() });
  return res.json().catch(() => []);
}
