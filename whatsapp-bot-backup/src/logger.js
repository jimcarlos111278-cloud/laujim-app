const logs = [];

export function log(...args) {
  const msg = args.map(a => typeof a === 'object' ? (a?.stack || JSON.stringify(a)) : String(a)).join(' ');
  logs.push({ ts: Date.now(), msg });
  console.log(...args);
}

export function getLogs() {
  return logs.slice();
}

export function clearLogs() {
  logs.length = 0;
}
