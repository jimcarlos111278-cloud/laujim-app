import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const STORE_PATH = join(DATA_DIR, 'wa-messages.json');

let store = { conversations: {} };

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    log('WA-STORE persist error: ' + e.message);
  }
}

function load() {
  try {
    if (existsSync(STORE_PATH)) {
      store = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
      if (!store.conversations) store.conversations = {};
    }
  } catch (e) {
    log('WA-STORE load error: ' + e.message);
    store = { conversations: {} };
  }
}

load();

export function addMessage(groupJid, apto, text, direction, sender) {
  if (!groupJid) return;
  if (!store.conversations[groupJid]) {
    store.conversations[groupJid] = { jid: groupJid, apto: apto || '', messages: [], unread: 0 };
  }
  const conv = store.conversations[groupJid];
  conv.apto = apto || conv.apto;
  conv.messages.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: text || '',
    direction,
    sender: sender || '',
    timestamp: new Date().toISOString(),
  });
  if (direction === 'in') conv.unread = (conv.unread || 0) + 1;
  if (conv.messages.length > 500) conv.messages.splice(0, conv.messages.length - 500);
  persist();
}

export function getConversations() {
  const list = Object.values(store.conversations).map(c => ({
    jid: c.jid,
    apto: c.apto,
    unread: c.unread || 0,
    lastMessage: c.messages.length > 0 ? c.messages[c.messages.length - 1] : null,
    messageCount: c.messages.length,
  }));
  list.sort((a, b) => {
    const ta = a.lastMessage?.timestamp || '';
    const tb = b.lastMessage?.timestamp || '';
    return tb.localeCompare(ta);
  });
  return list;
}

export function getMessages(groupJid) {
  const conv = store.conversations[groupJid];
  return conv ? conv.messages : [];
}

export function markRead(groupJid) {
  const conv = store.conversations[groupJid];
  if (conv) {
    conv.unread = 0;
    persist();
  }
}

export function getConversation(groupJid) {
  return store.conversations[groupJid] || null;
}
