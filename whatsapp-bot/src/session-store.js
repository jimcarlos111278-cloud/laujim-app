import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '..', 'data', 'session-store.json');

let sessions = {};

export function load() {
  try {
    if (existsSync(STORE_PATH)) {
      sessions = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading session store:', e.message);
    sessions = {};
  }
  return sessions;
}

function save() {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving session store:', e.message);
  }
}

export function getSession(phone) {
  return sessions[phone] || null;
}

export function setSession(phone, data) {
  sessions[phone] = { ...data, lastActivity: new Date().toISOString() };
  save();
}

export function updateSession(phone, updates) {
  if (sessions[phone]) {
    sessions[phone] = { ...sessions[phone], ...updates, lastActivity: new Date().toISOString() };
    save();
  }
}

export function deleteSession(phone) {
  delete sessions[phone];
  save();
}

export function getActiveSessions() {
  return Object.entries(sessions)
    .filter(([, s]) => s.status === 'activo')
    .map(([phone, data]) => ({ phone, ...data }));
}

export function getSessionByApto(apto) {
  const entry = Object.entries(sessions).find(([, s]) => s.apto === apto && s.status === 'activo');
  return entry ? { phone: entry[0], ...entry[1] } : null;
}

export function getAll() {
  return sessions;
}
