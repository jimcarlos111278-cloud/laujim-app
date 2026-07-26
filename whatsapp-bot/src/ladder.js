const MAX = 300;
let entries = [];
let stepCounter = 0;

export function push(dir, from, to, action, text, msgId, delivery, deliveryDetail, apto) {
  const entry = {
    step: ++stepCounter,
    ts: Date.now(),
    dir,
    from: from || '',
    to: to || '',
    action: action || '',
    text: text ? text.slice(0, 60) : '',
    msgId: msgId || '',
    delivery: delivery || '',
    deliveryDetail: deliveryDetail || '',
    apto: apto || '',
  };
  entries.push(entry);
  if (entries.length > MAX) entries.shift();
  return entry;
}

export function updateByMsgId(msgId, delivery, deliveryDetail) {
  if (!msgId) return;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].msgId === msgId) {
      entries[i].delivery = delivery;
      if (deliveryDetail) entries[i].deliveryDetail = deliveryDetail;
      return entries[i];
    }
  }
}

export function updateLatest(delivery, deliveryDetail) {
  if (entries.length === 0) return;
  const last = entries[entries.length - 1];
  last.delivery = delivery;
  if (deliveryDetail) last.deliveryDetail = deliveryDetail;
}

export function getLadder() {
  return entries.slice();
}

export function clearLadder() {
  entries = [];
  stepCounter = 0;
}

export function printSession(count) {
  const take = count || 10;
  const recent = entries.slice(-take);
  if (recent.length === 0) return '';
  let out = '\n══════════════════════════════════════════════════════════\n';
  out += '  LADDER (últimos ' + recent.length + ' pasos)\n';
  out += '══════════════════════════════════════════════════════════\n';
  for (const e of recent) {
    const time = new Date(e.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const num = e.step.toString().padStart(3);
    let line = '  ' + num + ' ' + time + ' ' + e.dir.padEnd(10) + ' "' + (e.text || '').slice(0, 40) + '"';
    const action = (e.action || '').slice(0, 24).padEnd(24);
    line += '  ' + action;
    if (e.apto) line += '  apto=' + e.apto;
    if (e.msgId) line += '  id=' + e.msgId.slice(0, 12);
    if (e.delivery) line += '  [' + e.delivery + ']';
    if (e.deliveryDetail) line += ' ' + e.deliveryDetail.slice(0, 25);
    out += line + '\n';
  }
  out += '══════════════════════════════════════════════════════════\n';
  return out;
}
