const MAX_LOG = 300;
const logs = [];

export function log(...args) {
  const msg = args.map(a => typeof a === 'object' ? (a?.stack || JSON.stringify(a)) : String(a)).join(' ');
  logs.push({ ts: Date.now(), msg });
  if (logs.length > MAX_LOG) logs.splice(0, logs.length - MAX_LOG);
  console.log(...args);
}

export function getLogs() {
  return logs.slice(-100);
}

export function clearLogs() {
  logs.length = 0;
}
