import * as api from './api-client.js';
import * as sessionStore from './session-store.js';
import { log } from './logger.js';

let heartbeatTimer = null;

export function startHeartbeat() {
  const interval = 10000;

  const beat = async () => {
    const active = sessionStore.getActiveSessions();
    for (const session of active) {
      try {
        await api.heartbeat('apt-' + session.aptId, 'online');
      } catch (e) {
        log('Heartbeat error for ' + session.apto + ': ' + e.message);
      }
    }
    try {
      await api.heartbeat('whatsapp-bot', 'online');
    } catch (e) { /* ignore */ }
  };

  beat();
  heartbeatTimer = setInterval(beat, interval);
  log('Heartbeat started (every ' + interval + 'ms)');
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
