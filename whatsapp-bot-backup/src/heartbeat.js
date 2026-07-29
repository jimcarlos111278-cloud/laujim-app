import { log } from './logger.js';

let heartbeatTimer = null;

export function startHeartbeat() {
  log('Heartbeat started');
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
