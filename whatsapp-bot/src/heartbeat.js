import { log } from './logger.js';

let heartbeatTimer = null;
const HEARTBEAT_INTERVAL = 30000;

export function startHeartbeat() {
  log('Heartbeat started (30s interval)');
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    log('Heartbeat tick');
  }, HEARTBEAT_INTERVAL);
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
