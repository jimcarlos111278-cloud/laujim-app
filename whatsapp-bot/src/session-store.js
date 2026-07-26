import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '..', 'data', 'session-store.json');
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || '1800000', 10);

let sessions = {};

function now() {
  return new Date().toISOString();
}

function isExpired(s) {
  if (!s.lastActivity) return false;
  return Date.now() - new Date(s.lastActivity).getTime() > SESSION_TIMEOUT;
}

export function load() {
  try {
    if (existsSync(STORE_PATH)) {
      sessions = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
      let changed = false;
      for (const [key, s] of Object.entries(sessions)) {
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
    writeFileSync(STORE_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving session store:', e.message);
  }
}

export function getSession(callerJid) {
  const s = sessions[callerJid] || null;
  if (s && s.state === 'ACTIVE' && isExpired(s)) {
    s.state = 'EXPIRED';
    save();
    return null;
  }
  return s;
}

export function setSession(callerJid, data) {
  sessions[callerJid] = { ...data, state: 'ACTIVE', createdAt: now(), lastActivity: now() };
  save();
}

export function updateSession(callerJid, updates) {
  if (sessions[callerJid]) {
    sessions[callerJid] = { ...sessions[callerJid], ...updates, lastActivity: now() };
    if (sessions[callerJid].state === 'ACTIVE' && sessions[callerJid].state !== updates.state) {
      save();
    } else {
      save();
    }
  }
}

export function deleteSession(callerJid) {
  delete sessions[callerJid];
  save();
}

export function getActiveSessions() {
  const result = [];
  let changed = false;
  for (const [key, s] of Object.entries(sessions)) {
    if (s.state === 'ACTIVE' && isExpired(s)) {
      s.state = 'EXPIRED';
      changed = true;
    }
    if (s.state === 'ACTIVE') {
      result.push({ callerJid: key, ...s });
    }
  }
  if (changed) save();
  return result;
}

export function getSessionByGroup(groupJid) {
  for (const [key, s] of Object.entries(sessions)) {
    if (s.groupJid === groupJid && s.state === 'ACTIVE') {
      if (isExpired(s)) {
        s.state = 'EXPIRED';
        save();
        return null;
      }
      return { callerJid: key, ...s };
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
  for (const [key, s] of Object.entries(sessions)) {
    if (s.state === 'ACTIVE' && isExpired(s)) {
      s.state = 'EXPIRED';
      changed = true;
    }
    if (s.state === 'EXPIRED') {
      delete sessions[key];
      changed = true;
    }
  }
  if (changed) save();
}
