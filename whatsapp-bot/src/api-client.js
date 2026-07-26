const BASE_URL = process.env.API_BASE_URL || 'http://localhost:1011/api';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'laujim laujim';

function headers() {
  return { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN };
}

export async function login(apto, cedula) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: String(apto), password: String(cedula) }),
  });
  return res.json();
}

export async function getApartmentByName(name) {
  const res = await fetch(`${BASE_URL}/apartments/first/name/${encodeURIComponent(String(name))}`, {
    headers: headers(),
  });
  return res.json();
}
