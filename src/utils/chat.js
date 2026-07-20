import db from '../db/database';
import { getBase, AUTH_TOKEN } from './config';

let lastCheck = new Date(0).toISOString();
let pollTimer = null;
let pollCallback = null;

export async function sendMessage(roomId, from, to, content) {
  const msg = { roomId, from, to, content, createdAt: new Date().toISOString(), read: false, type: 'text' };
  const localId = await db.messages.add(msg);
  const saved = { ...msg, id: localId };
  try {
    const base = getBase();
    const res = await fetch(base + '/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
      body: JSON.stringify(saved),
    });
    if (res.ok) {
      const serverMsg = await res.json();
      if (serverMsg.id !== localId) {
        await db.messages.delete(localId);
        await db.messages.add(serverMsg);
      }
    }
  } catch {}
  return msg;
}

export async function pollNewMessages() {
  try {
    const base = getBase();
    const res = await fetch(base + '/messages/updates/' + encodeURIComponent(lastCheck), {
      headers: { 'x-auth-token': AUTH_TOKEN }, signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const messages = await res.json();
    if (messages.length === 0) return;
    for (const msg of messages) {
      const existing = await db.messages.where({ roomId: msg.roomId, from: msg.from, createdAt: msg.createdAt }).first();
      if (!existing) await db.messages.add(msg);
    }
    const last = messages[messages.length - 1];
    lastCheck = new Date(new Date(last.createdAt).getTime() + 1).toISOString();
    if (pollCallback) pollCallback(messages);
  } catch {}
}

export function startChatPoll(callback, intervalMs = 3000) {
  stopChatPoll();
  pollCallback = callback;
  pollNewMessages();
  pollTimer = setInterval(pollNewMessages, intervalMs);
}

export function stopChatPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  pollCallback = null;
}

export async function getRoomMessages(roomId) {
  return db.messages.where('roomId').equals(roomId).sortBy('createdAt');
}

export async function getAllRooms(auth) {
  const apartments = await db.apartments.toArray();
  const rooms = [];
  rooms.push({ id: 'general', label: 'General', type: 'group' });
  if (auth.role === 'admin') {
    for (const apt of apartments) {
      if (apt.status === 'occupied' || apt.status === 'vacant') {
        rooms.push({ id: 'admin-' + apt.id, label: apt.name, type: 'dm' });
      }
    }
  }
  if (auth.role === 'tenant' && auth.apartmentId) {
    const apt = apartments.find(a => a.id === auth.apartmentId);
    if (apt) rooms.push({ id: 'admin-' + apt.id, label: 'Administrador', type: 'dm' });
  }
  return rooms;
}
