import db from '../db/database';
import { getBase, AUTH_TOKEN } from './config';

let lastCheck = new Date(0).toISOString();
let pollTimer = null;
let pollCallback = null;
let heartbeatTimer = null;
let presenceFetchTimer = null;
let presenceCallback = null;

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

export async function sendHeartbeat(userId, status) {
  try {
    const base = getBase();
    await fetch(base + '/presence/heartbeat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
      body: JSON.stringify({ userId, status }),
    });
  } catch {}
}

export async function fetchPresence() {
  try {
    const base = getBase();
    const res = await fetch(base + '/presence', {
      headers: { 'x-auth-token': AUTH_TOKEN }, signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
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
  stopHeartbeat();
}

export function startHeartbeat(userId, intervalMs = 10000) {
  stopHeartbeat();
  sendHeartbeat(userId, 'online');
  heartbeatTimer = setInterval(() => sendHeartbeat(userId, 'online'), intervalMs);
}

export function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

export function startPresencePoll(callback, intervalMs = 5000) {
  stopPresencePoll();
  presenceCallback = callback;
  callback(fetchPresence);
  presenceFetchTimer = setInterval(async () => {
    const data = await fetchPresence();
    if (presenceCallback) presenceCallback(data);
  }, intervalMs);
}

export function stopPresencePoll() {
  if (presenceFetchTimer) { clearInterval(presenceFetchTimer); presenceFetchTimer = null; }
  presenceCallback = null;
}

export function getStatusLabel(presence, userId) {
  if (!presence || !userId) return { dot: 'bg-gray-400', label: 'Desconocido' };
  const p = presence.find(x => x.userId === userId);
  if (!p) return { dot: 'bg-gray-400', label: 'Desconocido' };
  const elapsed = Date.now() - new Date(p.lastSeen).getTime();
  const secs = Math.floor(elapsed / 1000);
  if (p.status === 'online' && secs < 15) return { dot: 'bg-green-500', label: 'En línea' };
  if (p.status === 'away' || (p.status === 'online' && secs < 60)) return { dot: 'bg-amber-400', label: 'Ausente' };
  if (secs < 120) return { dot: 'bg-gray-400', label: 'Visto hace ' + secs + 's' };
  if (secs < 3600) return { dot: 'bg-gray-400', label: 'Visto hace ' + Math.floor(secs / 60) + 'min' };
  const d = new Date(p.lastSeen);
  return { dot: 'bg-gray-400', label: 'Visto ' + d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) };
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
