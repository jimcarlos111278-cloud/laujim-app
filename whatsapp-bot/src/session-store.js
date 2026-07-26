import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const STORE_PATH = join(DATA_DIR, 'session-store.json');
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || '1800000', 10);

try { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); } catch {}

let sessions = {};

function now() {
  return new Date().toISOString();
}

function isExpired(s) {
  if (!s.lastActivity) return false;
  return Date.now() - new Date(s.lastActivity).getTime() > SESSION_TIMEOUT;
}

function key(convJid) {
  return convJid || '';
}

export function load() {
  try {
    if (existsSync(STORE_PATH)) {
      sessions = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
      let changed = false;
      for (const s of Object.values(sessions)) {
        if (s.state === 'ACTIVE' && isExpired(s)) {
          s.state = 'EXPIRED';
          changed = true;
        }
      }
      if (changed) save();
    }
  } catch (e) {
    console.error('Error loading session store:', e.message);
    sessions = {};
  }
  return sessions;
}

function save() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving session store:', e.message);
  }
}

export function getSession(convJid) {
  const k = key(convJid);
  const s = sessions[k] || null;
  if (s && s.state === 'ACTIVE' && isExpired(s)) {
    s.state = 'EXPIRED';
    save();
    return null;
  }
  return s;
}

export function setSession(convJid, data) {
  const k = key(convJid);
  const nowStr = now();
  const sessionData = {
    conversationJid: convJid,
    ...data,
    state: 'ACTIVE',
    createdAt: nowStr,
    lastActivity: nowStr,
  };
  if (sessions[k]) {
    delete sessions[k];
  }
  sessions[k] = sessionData;
  save();
}

export function updateSession(convJid, updates) {
  const k = key(convJid);
  if (sessions[k]) {
    sessions[k] = { ...sessions[k], ...updates, lastActivity: now() };
    save();
  }
}

export function deleteSession(convJid) {
  const k = key(convJid);
  delete sessions[k];
  save();
}

export function getActiveSessions() {
  const result = [];
  let changed = false;
  for (const [k, s] of Object.entries(sessions)) {
    if (s.state === 'ACTIVE' && isExpired(s)) {
      s.state = 'EXPIRED';
      changed = true;
    }
    if (s.state === 'ACTIVE') {
      result.push({ callerJid: k, ...s });
    }
  }
  if (changed) save();
  return result;
}

export function getSessionByGroup(groupJid) {
  for (const s of Object.values(sessions)) {
    if (s.groupJid === groupJid && s.state === 'ACTIVE') {
      if (isExpired(s)) {
        s.state = 'EXPIRED';
        save();
        return null;
      }
      return s;
    }
  }
  return null;
}

export function expireAll() {
  let changed = false;
  for (const s of Object.values(sessions)) {
    if (s.state === 'ACTIVE') {
      s.state = 'EXPIRED';
      changed = true;
    }
  }
  if (changed) save();
}

export function getAll() {
  return sessions;
}

export function cleanupExpired() {
  let changed = false;
  for (const [k, s] of Object.entries(sessions)) {
    if (s.state === 'ACTIVE' && isExpired(s)) {
      s.state = 'EXPIRED';
      changed = true;
    }
    if (s.state === 'EXPIRED') {
      delete sessions[k];
      changed = true;
    }
  }
  if (changed) save();
}

export function closeExistingSessionForGroup(groupJid) {
  for (const [k, s] of Object.entries(sessions)) {
    if (s.groupJid === groupJid && s.state === 'ACTIVE') {
      delete sessions[k];
      save();
      return true;
    }
  }
  return false;
}
