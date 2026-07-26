const BASE_URL = process.env.API_BASE_URL || 'http://localhost:1011/api';

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
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
}
