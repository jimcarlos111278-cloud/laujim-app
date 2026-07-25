const BASE_URL = process.env.API_BASE_URL || 'http://localhost:1011/api';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'laujim laujim';

function headers() {
  return {
    'Content-Type': 'application/json',
    'x-auth-token': AUTH_TOKEN,
  };
}

export async function login(apto, cedula) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: String(apto), password: String(cedula) }),
  });
  return res.json();
}

export async function sendMessage(roomId, from, to, content, source) {
  const msg = {
    roomId,
    from,
    to,
    content,
    createdAt: new Date().toISOString(),
    read: false,
    type: 'text',
    source: source || 'whatsapp',
  };
  const res = await fetch(`${BASE_URL}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(msg),
  });
  return res.json();
}

export async function getMessagesSince(since) {
  const res = await fetch(`${BASE_URL}/messages/updates/${encodeURIComponent(since)}`, {
    headers: headers(),
  });
  return res.json();
}

export async function heartbeat(userId, status) {
  const res = await fetch(`${BASE_URL}/presence/heartbeat`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ userId, status: status || 'online' }),
  });
  return res.json();
}

export async function getApartments() {
  const res = await fetch(`${BASE_URL}/apartments`, { headers: headers() });
  return res.json();
}

export async function getTenants() {
  const res = await fetch(`${BASE_URL}/tenants`, { headers: headers() });
  return res.json();
}

export async function getContracts() {
  const res = await fetch(`${BASE_URL}/contracts`, { headers: headers() });
  return res.json();
}

export async function getApartmentByName(name) {
  const res = await fetch(`${BASE_URL}/apartments/first/name/${encodeURIComponent(String(name))}`, {
    headers: headers(),
  });
  return res.json();
}

export async function getMessagesByRoom(roomId) {
  const res = await fetch(`${BASE_URL}/messages/where/roomId/${encodeURIComponent(roomId)}`, {
    headers: headers(),
  });
  return res.json();
}

export async function getSetting(key) {
  const res = await fetch(`${BASE_URL}/settings`, { headers: headers() });
  const settings = await res.json();
  const found = (settings || []).find(s => s.key === key);
  return found ? found.value : null;
}

export async function getSettings() {
  const res = await fetch(`${BASE_URL}/settings`, { headers: headers() });
  const settings = await res.json();
  const map = {};
  (settings || []).forEach(s => { map[s.key] = s.value; });
  return map;
}
