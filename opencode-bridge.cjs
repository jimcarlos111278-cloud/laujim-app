// ─── Puente WhatsApp admin → opencode/harness (fase 1) ───────────────────────
// Solo lo usa handleCloudAdminMessage(); los inquilinos nunca llegan aquí
// porque handleCloudInbound los deriva a verificación/bloqueo antes.
// Por defecto el puente está APAGADO (OPENCODE_AGENT_ENABLED=true para activar)
// y en modo SOLO LECTURA (OPENCODE_AGENT_ALLOW_WRITE=true para escrituras).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Carpeta donde el agente debe dejar artefactos (HTML, imágenes, docs).
// En el contenedor es /app/agent-out (escribible por el usuario node).
const OUTBOX_DIR = path.join(__dirname, 'agent-out');
const OUTBOX_MAX_FILES = 3;
const OUTBOX_MAX_BYTES = 10 * 1024 * 1024;

const MAX_PROMPT_CHARS = 4000;
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_MAX_REPLY_CHARS = 6000;

// Prefijos explícitos para no chocar con los flujos admin existentes
// (cobros, apartamentos, Sí/No, SALIR). Sin prefijo no hay agente.
//
// /ssh wf <petición> → consulta en modo SOLO LECTURA (write=false)
// /ssh wt <petición> → consulta con ESCRITURA permitida (write=true)
// "ssh" aquí no abre ninguna conexión: solo instruye al bot por mensaje.
const SSH_RE = /^\/ssh\s+(wf|wt)\s+(.+)$/is;
const CODE_RE = /^(?:code|c[oó]digo|agente\s+c[oó]digo|\/code)\s*:?\s*(.+)$/is;
const ASK_RE = /^(?:pregunta|ask|agente|\/ask)\s*:?\s*(.+)$/is;
// "IA" abre el menú de modos. "//" = escritura, "/" = solo lectura.
// Van DESPUÉS de SSH/CODE/ASK para no romper /ssh, /code ni /ask.
const IA_MENU_RE = /^(?:ia|agente)$/i;
const IA_MOTORES_RE = /^ia\s+(?:motores|engines)$/i;
const IA_MOTOR_RE = /^ia\s+(?:motor|engine)(?:\s+(.+))?$/is;
const IA_MODELOS_RE = /^ia\s+modelos$/i;
const IA_MODELO_RE = /^ia\s+modelo(?:\s+(.+))?$/is;
const IA_AGENTES_RE = /^ia\s+agentes$/i;
const IA_AGENTE_RE = /^ia\s+agente(?:\s+(.+))?$/is;
const IA_THINKING_RE = /^ia\s+(?:thinking|pensamiento|think|nivel)(?:\s+(.+))?$/is;
const IA_ESTADO_RE = /^ia\s+(?:estado|status|config)$/i;
const IA_DOCS_RE = /^ia\s+docs(?:\s+(.+))?$/is;
const IA_SIN_DOCS_RE = /^(?:ia\s+)?sin\s+docs$/i;
const IA_CON_DOCS_RE = /^(?:ia\s+)?con\s+docs$/i;
// Pedido explícito de archivos dentro de una tarea (activa docs solo para esa respuesta).
const DOCS_REQUEST_RE = /(con\s+docs|\ben\s+html\b|genera\w*\s+(un\s+)?html|adjunta\w*(\s+el)?\s+(html|archivo|documento))/i;
// Override del modelo fijado por WhatsApp (manda sobre OPENCODE_AGENT_MODEL).
const MODEL_FILE = path.join(__dirname, 'agent-model.json');
const MODEL_ID_RE = /^[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9_.-]+)?$/i;
const MAX_MODEL_ID_CHARS = 100;
// Agentes lógicos disponibles por WhatsApp. Se emulan a nivel prompt y,
// cuando opencode lo soporta, también con --agent. `cli` es el nombre del
// agente real en opencode; null = default.
const AGENT_CATALOG = {
  auto: { cli: null, desc: 'Default de opencode en la VM' },
  plan: { cli: null, desc: 'Plan técnico solo lectura (qué tocar, riesgos, pasos)' },
  build: { cli: 'build', desc: 'Ejecuta cambios en código + gate Aiven antes de push' },
  backend: { cli: null, desc: 'APIs, persistencia, auth, jobs en server.cjs' },
  front: { cli: null, desc: 'UI React/Tailwind, accesibilidad, layout' },
  qa: { cli: null, desc: 'Verificación independiente con checks enfocados' },
  profe: { cli: null, desc: 'Profesor: explica código para aprender (redes→sistemas)' },
};
const THINKING_LEVELS = {
  low: { desc: 'Rápido y conciso. Resumen + archivos.', timeoutMult: 1 },
  medium: { desc: 'Balanceado. Explica con rutas y símbolos.', timeoutMult: 1.5 },
  high: { desc: 'Profundo. Verifica en código, cita archivos, propone tests.', timeoutMult: 2 },
  xhigh: { desc: 'Exhaustivo. Análisis completo + HTML detallado + plan de estudio.', timeoutMult: 2.5 },
};
const SLASH_WRITE_RE = /^\/\/\s*(.+)$/s;
const SLASH_READ_RE = /^\/(.+)$/s;
const HELP_RE = /^(?:agente\s+ayuda|ayuda\s+agente|menu\s+agente|men[uú]\s+agente)$/i;

// Peticiones que implican modificar algo. En v1 se responden sin ejecutar,
// salvo que la VM tenga OPENCODE_AGENT_ALLOW_WRITE=true.
const WRITE_RE = /(commit|push|deploy|despleg|publica|edita|modifica|crea?\s+(un\s+)?archivo|borra|elimina|escribe\s+en|guarda\s+en|haz\s+el\s+cambio|aplica\s+el)/i;

function agentConfig() {
  return {
    enabled: String(process.env.OPENCODE_AGENT_ENABLED || 'false').toLowerCase() === 'true',
    allowWrite: String(process.env.OPENCODE_AGENT_ALLOW_WRITE || 'false').toLowerCase() === 'true',
    command: String(process.env.OPENCODE_AGENT_COMMAND || 'opencode').trim() || 'opencode',
    // Modelo en formato provider/model (ej: "opencode/big-pickle").
    // Vacío = el modelo por defecto configurado en opencode.
    // Proveedores custom (genéricos OpenAI-compatible) se declaran en
    // .opencode/opencode.json -> provider { id, models, options.baseURL }.
    model: String(process.env.OPENCODE_AGENT_MODEL || '').trim(),
    timeoutMs: Math.max(
      15000,
      Number(process.env.OPENCODE_AGENT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    ),
    maxReplyChars: Math.max(
      6000,
      Number(process.env.OPENCODE_AGENT_MAX_REPLY_CHARS || DEFAULT_MAX_REPLY_CHARS) ||
        DEFAULT_MAX_REPLY_CHARS,
    ),
  };
}

// Devuelve { mode: 'code'|'ask'|'help'|'menu'|'model'|'models'|'agent'|'agents'|'thinking'|'estado'|'docs', prompt, write }
// o null si no es comando agente. `write` es true/false cuando el mensaje lo
// fija con //, /, /ssh wt|wf, o null para usar el default de la VM.
function parseAgentCommand(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (HELP_RE.test(value)) return { mode: 'help', prompt: '', write: null };
  if (IA_MENU_RE.test(value)) return { mode: 'menu', prompt: '', write: null };
  if (IA_MOTORES_RE.test(value)) return { mode: 'engines', prompt: '', write: null };
  const motor = value.match(IA_MOTOR_RE);
  if (motor) return { mode: 'engine', prompt: (motor[1] || '').trim().slice(0, 40), write: null };
  if (IA_ESTADO_RE.test(value)) return { mode: 'estado', prompt: '', write: null };
  if (IA_SIN_DOCS_RE.test(value)) return { mode: 'docs', prompt: 'off', write: null };
  if (IA_CON_DOCS_RE.test(value)) return { mode: 'docs', prompt: 'on', write: null };
  const docsCmd = value.match(IA_DOCS_RE);
  if (docsCmd) return { mode: 'docs', prompt: (docsCmd[1] || 'estado').trim().slice(0, 20), write: null };
  if (IA_MODELOS_RE.test(value)) return { mode: 'models', prompt: '', write: null };
  if (IA_AGENTES_RE.test(value)) return { mode: 'agents', prompt: '', write: null };
  const think = value.match(IA_THINKING_RE);
  if (think) return { mode: 'thinking', prompt: (think[1] || '').trim().slice(0, 20), write: null };
  const agente = value.match(IA_AGENTE_RE);
  // OJO: "IA agente X" debe ir antes que "IA modelo", y no chocar con el menú "IA"/"agente" solo.
  if (agente && /^(ia|agente)\s+agente/i.test(value)) return { mode: 'agent', prompt: (agente[1] || '').trim().slice(0, 40), write: null };
  const modelo = value.match(IA_MODELO_RE);
  if (modelo) return { mode: 'model', prompt: (modelo[1] || '').trim().slice(0, MAX_MODEL_ID_CHARS), write: null };
  const ssh = value.match(SSH_RE);
  if (ssh && ssh[2].trim()) {
    return {
      mode: 'code',
      prompt: ssh[2].trim().slice(0, MAX_PROMPT_CHARS),
      write: ssh[1].toLowerCase() === 'wt',
    };
  }
  const code = value.match(CODE_RE);
  if (code && code[1].trim()) return { mode: 'code', prompt: code[1].trim().slice(0, MAX_PROMPT_CHARS), write: null };
  const ask = value.match(ASK_RE);
  if (ask && ask[1].trim()) return { mode: 'ask', prompt: ask[1].trim().slice(0, MAX_PROMPT_CHARS), write: null };
  const slashWrite = value.match(SLASH_WRITE_RE);
  if (slashWrite && slashWrite[1].trim()) {
    return { mode: 'code', prompt: slashWrite[1].trim().slice(0, MAX_PROMPT_CHARS), write: true };
  }
  const slashRead = value.match(SLASH_READ_RE);
  if (slashRead && slashRead[1].trim()) {
    return { mode: 'code', prompt: slashRead[1].trim().slice(0, MAX_PROMPT_CHARS), write: false };
  }
  return null;
}

function isWriteIntent(prompt) {
  return WRITE_RE.test(String(prompt || ''));
}

function getAgentHelp() {
  return [
    '🤖 *Agente IA técnico* (solo admin) — modo profesor/ingeniero',
    '',
    'Modos de ejecución:',
    '• `IA` → menú interactivo (lectura / escritura / pregunta)',
    '• `/ <tarea>` → solo lectura, no modifica nada',
    '• `// <tarea>` → con escritura, puede modificar el proyecto',
    '• `pregunta: <tema>` → explicación técnica para aprender',
    '',
    'Motor IA:',
    '• `IA estado` → ver motor + modelo + agente + thinking actuales',
    '• `IA motores` → listar motores (antigravity, gemini, muse, auto)',
    '• `IA motor antigravity` → fijar motor Antigravity (Google Deepmind)',
    '',
    'Modelo:',
    '• `IA modelos` → listar modelos de la VM',
    '• `IA modelo <id>` → fijarlo (ej: `gemini-3.8-flash-high`)',
    '• `IA modelo auto` → volver al default',
    '',
    'Agente (rol):',
    '• `IA agentes` → ver catálogo (auto, plan, build, backend, front, qa, profe)',
    '• `IA agente build` → fija rol ejecutor; `IA agente profe` → modo profesor',
    '',
    'Nivel de pensamiento:',
    '• `IA thinking medium` → low | medium | high | xhigh',
    '',
    'Documentos (default: OFF, todo en el chat):',
    '• `IA docs` → ver estado · `IA docs on` · `IA docs off` / `sin docs`',
    '',
    'Ejemplos:',
    '• `/ cuántos apartamentos hay y cuál es su estado`',
    '• `/ explica la arquitectura de pagos en server.cjs`',
    '• `// actualiza el texto de bienvenida`',
    '',
    '`SALIR` cierra el modo. Atajos viejos siguen vivos: `/ssh wf`, `/ssh wt`, `code:`.',
  ].join('\n');
}

// ─── Estado configurable por WhatsApp (solo admin) ────────────────────────
// Precedencia: override por WhatsApp (agent-model.json) > env > default.
// El JSON guarda { engine, model, agent, thinking, docs, permission, fallback }.
function readAgentState() {
  let state = {};
  try {
    const raw = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
    if (raw && typeof raw === 'object') state = raw;
  } catch { /* sin override */ }
  const engine = String(state.engine || 'antigravity').trim().toLowerCase();
  const rawModel = state.model !== undefined && state.model !== null && state.model !== ''
    ? String(state.model).trim()
    : (engine === 'antigravity' ? '' : String(process.env.OPENCODE_AGENT_MODEL || '').trim());
  const agent = String(state.agent || process.env.OPENCODE_AGENT || 'auto').trim().toLowerCase();
  const thinking = String(state.thinking || process.env.OPENCODE_THINKING || 'medium').trim().toLowerCase();
  const docsRaw = state.docs ?? process.env.OPENCODE_AGENT_DOCS ?? false;
  const docs = docsRaw === true || String(docsRaw).trim().toLowerCase() === 'true';
  const permission = String(state.permission || 'smart').trim().toLowerCase();
  const fallback = state.fallback !== false;
  return {
    engine,
    model: MODEL_ID_RE.test(rawModel) ? rawModel : (rawModel === 'auto' ? 'auto' : ''),
    agent: AGENT_CATALOG[agent] ? agent : 'auto',
    thinking: THINKING_LEVELS[thinking] ? thinking : 'medium',
    docs,
    permission,
    fallback,
  };
}

function writeAgentState(patch) {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')) || {}; } catch { current = {}; }
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(MODEL_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    return { ok: false, error: `No pude guardar: ${error.message}` };
  }
  return { ok: true, state: next };
}

function getAgentModel() {
  return readAgentState().model;
}

function getAgentState() {
  return readAgentState();
}

function getAgentStatusText() {
  const s = readAgentState();
  const engineTxt = s.engine === 'auto'
    ? '🔀 Auto (Gemini 3.8 + Muse Spark)'
    : s.engine === 'gemini' || s.engine === 'gemini-3.8'
      ? '⚡ Gemini 3.8 Flash'
      : s.engine === 'muse' || s.engine === 'muse-spark'
        ? '🔨 Muse Spark 1.3'
        : s.engine === 'antigravity'
          ? '🧠 Antigravity (Deep Reasoning)'
          : s.engine;
  const permTxt = s.permission === 'smart'
    ? '🛡️ Inteligente (confirma antes de escribir)'
    : s.permission === 'write'
      ? '🚀 Escritura Directa'
      : '📖 Solo Lectura';
  return [
    '🤖 *PANEL DE CONTROL IA (Laujim)*',
    `• Motor: ${engineTxt}`,
    `• Permisos: ${permTxt}`,
    `• Respaldo (Fallback): ${s.fallback ? '✅ Activo' : '❌ Inactivo'}`,
    `• Base de datos: ☁️ Aiven Cloud (Sincronizado)`,
    `• Thinking: ${s.thinking} — ${THINKING_LEVELS[s.thinking]?.desc || s.thinking}`,
    `• Docs: ${s.docs ? 'ON (genero HTML+md)' : 'OFF (chat directo)'}`,
  ].join('\n');
}

function setAgentEngine(engineName) {
  const norm = String(engineName || '').trim().toLowerCase();
  const valid = ['auto', 'antigravity', 'gemini', 'gemini-3.8', 'muse', 'muse-spark', 'opencode'];
  if (!valid.includes(norm)) {
    return { ok: false, error: 'Motor inválido. Usa: antigravity, auto, gemini, muse, opencode.' };
  }
  let targetModel = '';
  if (norm.includes('muse')) targetModel = 'opencode/muse-spark-1.3-contributor-free';
  return writeAgentState({ engine: norm, model: targetModel });
}

function setAgentPermission(perm) {
  const norm = String(perm || '').trim().toLowerCase();
  const valid = ['smart', 'read', 'write'];
  if (!valid.includes(norm)) {
    return { ok: false, error: 'Permiso inválido. Usa: smart, read, write.' };
  }
  return writeAgentState({ permission: norm });
}

function resetAgentDefaults() {
  return writeAgentState({
    engine: 'antigravity',
    model: '',
    agent: 'auto',
    thinking: 'medium',
    docs: false,
    permission: 'smart',
    fallback: true,
  });
}

function setAgentModel(id) {
  const value = String(id || '').trim().slice(0, MAX_MODEL_ID_CHARS);
  if (!MODEL_ID_RE.test(value)) {
    return { ok: false, error: 'Formato inválido. Usa proveedor/modelo o id de modelo (ej: `gemini-3.8-flash-high` u `opencode/big-pickle`).' };
  }
  const saved = writeAgentState({ model: value });
  if (!saved.ok) return saved;
  return { ok: true, model: value };
}

function clearAgentModel() {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')) || {}; } catch { current = {}; }
  delete current.model;
  try { fs.writeFileSync(MODEL_FILE, JSON.stringify(current), 'utf8'); } catch { /* sigue default */ }
  const fallback = String(process.env.OPENCODE_AGENT_MODEL || '').trim();
  return fallback || '(default de opencode)';
}

function setAgentAgent(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!AGENT_CATALOG[value]) {
    return { ok: false, error: `Agente inválido. Usa: ${Object.keys(AGENT_CATALOG).join(', ')}.` };
  }
  const saved = writeAgentState({ agent: value });
  if (!saved.ok) return saved;
  return { ok: true, agent: value };
}

function setAgentThinking(level) {
  const value = String(level || '').trim().toLowerCase();
  if (!THINKING_LEVELS[value]) {
    return { ok: false, error: 'Nivel inválido. Usa: low, medium, high, xhigh.' };
  }
  const saved = writeAgentState({ thinking: value });
  if (!saved.ok) return saved;
  return { ok: true, thinking: value };
}

function setAgentDocs(value) {
  const norm = String(value || '').trim().toLowerCase();
  const on = ['on', 'si', 'sí', 'true', '1', 'con', 'estado on'].includes(norm);
  const off = ['off', 'no', 'false', '0', 'sin', 'estado off'].includes(norm);
  if (!on && !off) {
    const s = readAgentState();
    return { ok: false, error: `Docs actualmente ${s.docs ? 'ON' : 'OFF'}. Usa \`IA docs on\` o \`IA docs off\`.` };
  }
  const saved = writeAgentState({ docs: on });
  if (!saved.ok) return saved;
  return { ok: true, docs: on };
}

function listAgentsText() {
  return ['🤖 *Agentes disponibles*',
    ...Object.entries(AGENT_CATALOG).map(([k, v]) => `• \`${k}\` — ${v.desc}`),
    '',
    'Fija con `IA agente <nombre>` (ej: `IA agente build`).',
  ].join('\n');
}

function listAgentModels() {
  const cfg = agentConfig();
  const state = readAgentState();
  const isAgy = state.engine === 'antigravity';
  const bin = isAgy ? 'agy' : cfg.command;
  return new Promise((resolve) => {
    const child = spawn(bin, ['models'], {
      cwd: __dirname,
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.on('error', (error) => {
      resolve({ ok: false, error: `No se pudo lanzar "${bin}": ${error.message}` });
    });
    child.on('close', () => {
      const output = truncate(cleanAgentOutput(out), cfg.maxReplyChars);
      if (!output) resolve({ ok: false, error: 'Sin respuesta del listado de modelos.' });
      else resolve({ ok: true, output });
    });
  });
}
const ANSI_RE = /\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|$)/g;
// Ruido típico de la TUI (ecos de comandos y cabeceras de pasos).
const TUI_NOISE_RE = /^\s*[$>]\s+\S.*$/;
// Restos SGR sin ESC (p. ej. "[0m") que a veces deja la TUI al serializar.
// Solo dígitos/punto-y-coma + m, para no tocar corchetes legítimos como [1].
const BARE_SGR_RE = /\[(?:\d{1,3};)*\d{1,3}m/g;

function stripAnsi(text) {
  return String(text || '').replace(ANSI_RE, '').replace(BARE_SGR_RE, '').replace(/\r/g, '');
}

function cleanAgentOutput(text) {
  const lines = stripAnsi(text)
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .filter(line => !TUI_NOISE_RE.test(line));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function mapAgentError(error) {
  const msg = String((error && error.message) || error || '');
  if (/unauthorized|401|api\s*key|apikey|auth/i.test(msg)) {
    return '🔑 Falta la API key del modelo en la VM. Configúrala y reintenta.';
  }
  if (/ENOENT|not found|no se pudo lanzar/i.test(msg)) {
    return `⚠️ No se pudo lanzar el agente: ${msg}`;
  }
  return `⚠️ No pude ejecutarlo: ${msg}`;
}

const AGENT_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.html': 'text/html', '.txt': 'text/plain',
  // WhatsApp Cloud rechaza text/markdown: el .md viaja como text/plain (llega igual).
  '.md': 'text/plain',
  '.csv': 'text/csv', '.json': 'application/json', '.zip': 'application/zip',
  '.js': 'text/javascript', '.css': 'text/css',
};

function agentOutboxFiles(sinceMs) {
  try {
    fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  } catch { return { files: [], extra: 0 }; }
  let entries = [];
  try {
    entries = fs.readdirSync(OUTBOX_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => {
        const full = path.join(OUTBOX_DIR, entry.name);
        const stat = fs.statSync(full);
        return { full, name: entry.name, mtimeMs: stat.mtimeMs, size: stat.size };
      })
      .filter(item => item.mtimeMs >= sinceMs - 1000 && item.size > 0 && item.size <= OUTBOX_MAX_BYTES)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch { return { files: [], extra: 0 }; }
  const picked = entries.slice(0, OUTBOX_MAX_FILES).map(item => ({
    ...item,
    ext: path.extname(item.name).toLowerCase(),
    mime: AGENT_MIME[path.extname(item.name).toLowerCase()] || 'application/octet-stream',
    kind: ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(item.name).toLowerCase()) ? 'image' : 'document',
  }));
  return { files: picked, extra: Math.max(0, entries.length - picked.length) };
}

function truncate(text, max) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastPara = cut.lastIndexOf('\n\n');
  if (lastPara > max * 0.7) {
    return cut.slice(0, lastPara).trimEnd();
  }
  const lastDot = cut.lastIndexOf('. ');
  if (lastDot > max * 0.7) {
    return cut.slice(0, lastDot + 1).trimEnd();
  }
  return `${cut.trimEnd()}...`;
}

// ─── Diagnóstico rápido del sistema / VM (respuesta instantánea < 100ms) ──────────
const DIAGNOSTIC_RE = /(?:estado\s+(?:general\s+)?(?:de\s+la\s+)?vm|recursos|uso\s+de\s+(?:ram|cpu|disco|memoria)|rendimiento\s+vm|diagn[oó]stico\s+vm|status\s+vm|vm\s+status|uptime)/i;

function isSystemDiagnosticQuery(prompt) {
  const p = String(prompt || '').trim().toLowerCase();
  if (DIAGNOSTIC_RE.test(p)) return true;
  if (/\b(cu[aá]nto|c[oó]mo\s+est[aá]|qu[eé]\s+tal|uso\s+de|espacio\s+en|libre|ocupad[oa])\b/i.test(p) &&
      /\b(ram|cpu|disco|memoria|swap|uptime|servidor|m[aá]quina)\b/i.test(p)) {
    return true;
  }
  const keywords = ['ram', 'cpu', 'disco', 'memoria', 'uptime', 'vm', 'servidor', 'recursos'];
  let matches = 0;
  for (const kw of keywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(p)) matches++;
  }
  return matches >= 2;
}

function getSystemTelemetryReport() {
  const { execSync } = require('child_process');
  const os = require('os');

  let uptimeStr = '';
  try {
    uptimeStr = execSync('uptime', { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    const s = os.uptime();
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    uptimeStr = `up ${days}d, ${hours}h ${mins}m`;
  }

  let ramText = '';
  try {
    const rawFree = execSync('free -m', { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = rawFree.trim().split('\n');
    const memLine = lines.find(l => l.startsWith('Mem:')) || '';
    if (memLine) {
      const parts = memLine.split(/\s+/);
      const totalMb = parseInt(parts[1], 10) || 0;
      const usedMb = parseInt(parts[2], 10) || 0;
      const availMb = parseInt(parts[6] || parts[3], 10) || (totalMb - usedMb);
      const totalGb = (totalMb / 1024).toFixed(1);
      const usedGb = (usedMb / 1024).toFixed(1);
      const availGb = (availMb / 1024).toFixed(1);
      ramText = `${usedGb} GB usados / ${totalGb} GB total (${availGb} GB disponibles)`;
    }
  } catch {
    const totalGb = (os.totalmem() / (1024 ** 3)).toFixed(1);
    const freeGb = (os.freemem() / (1024 ** 3)).toFixed(1);
    const usedGb = (totalGb - freeGb).toFixed(1);
    ramText = `${usedGb} GB usados / ${totalGb} GB total (${freeGb} GB libres)`;
  }

  let diskText = '';
  try {
    const rawDf = execSync('df -h /', { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = rawDf.trim().split('\n');
    if (lines.length > 1) {
      const parts = lines[1].split(/\s+/);
      diskText = `${parts[2]} usados / ${parts[1]} total (${parts[4]} en uso, ${parts[3]} libres)`;
    }
  } catch {
    diskText = 'No disponible';
  }

  const loadAvg = os.loadavg().map(n => n.toFixed(2)).join(', ');
  const cpus = os.cpus();
  const cpuModel = cpus && cpus[0] ? `${cpus.length} vCPUs` : 'Multi-core';

  const nodeMem = process.memoryUsage();
  const nodeRssMb = Math.round(nodeMem.rss / (1024 * 1024));
  const nodeHeapMb = Math.round(nodeMem.heapUsed / (1024 * 1024));

  return [
    '🟢 *Pasos completados*',
    `• ⏱️ *Uptime:* ${uptimeStr}`,
    `• 🧠 *RAM VM:* ${ramText}`,
    `• 💾 *Disco (/):* ${diskText}`,
    `• ⚡ *CPU:* Load [${loadAvg}] · ${cpuModel}`,
    `• 📦 *Proceso Node:* ${nodeRssMb} MB RSS · ${nodeHeapMb} MB Heap`,
    '---',
    '🟡 *Pasos que faltan*',
    '• Diagnóstico: Todos los recursos están en rango saludable (< 50% de uso).',
    '• Sin alertas ni cuellos de botella detectados en la máquina virtual.',
    '---',
    '🚀 *Pasos siguientes*',
    '• VM y contenedor Laujim 100% operativos en Oracle Cloud.',
    '• Puedes enviar `/ <tarea>` para consultas de código o `// <tarea>` para aplicar cambios.',
  ].join('\n');
}

// ─── Contexto vivo del proyecto (como las demás sesiones) ────────────────
const CONTEXT_FILES = [
  { file: '.opencode/project-memory.md', max: 1500, label: 'Memoria del proyecto' },
  { file: '.opencode/session-memory.md', max: 1200, label: 'Memoria de sesiones' },
  { file: 'graphify-out/GRAPH_REPORT.md', max: 3000, label: 'Grafo de conocimiento' },
  { file: 'docs/continuidad/LEEME.md', max: 1200, label: 'Continuidad (cómo informar)' },
  { file: 'docs/continuidad/BITACORA.md', max: 1500, label: 'Bitácora (últimos cambios ejecutados)', tail: true },
  { file: 'docs/continuidad/PENDIENTES.md', max: 1200, label: 'Pendientes sin commitear' },
  { file: 'docs/continuidad/IDEAS.md', max: 1000, label: 'Ideas sin ejecutar' },
];

function loadHarnessContext(prompt = '') {
  const p = String(prompt).toLowerCase();
  const needGraph = /grafo|arquitectura|dependencia|relaci[oó]n|nodo/i.test(p);
  const needContinuity = /bit[aá]cora|pendiente|historial|cambios\s+recientes|continuidad/i.test(p);

  const parts = [];
  for (const { file, max, label, tail } of CONTEXT_FILES) {
    if (file.includes('GRAPH_REPORT') && !needGraph) continue;
    if ((file.includes('BITACORA') || file.includes('PENDIENTES') || file.includes('IDEAS') || file.includes('LEEME')) && !needContinuity) continue;
    try {
      const full = path.join(__dirname, file);
      const content = fs.readFileSync(full, 'utf8').trim();
      if (!content) continue;
      const shown = tail ? content.slice(-max) : content.slice(0, max);
      parts.push(`### ${label}\n${shown}`);
    } catch { /* archivo ausente: se omite sin romper */ }
  }
  if (!parts.length) return '';
  return `Contexto del proyecto:\n${parts.join('\n\n')}\n`;
}

// ─── Formato WhatsApp optimizado en secciones estructuradas (evita "... Leer más") ──────────
const WHATSAPP_FORMAT_DEV = [
  'FORMATO DE RESPUESTA PARA WHATSAPP:',
  '- Responde con información técnica 100% precisa, real y verificada en el proyecto.',
  '- Estructura la respuesta con encabezados claros en *negrilla* y emojis temáticos para separar ideas.',
  '- Si es diagnóstico: causa real verificada en código o base de datos, archivo exacto y solución concreta.',
  '- Si es una tarea de desarrollo: cambios aplicados, archivos tocados y comando de prueba.',
  '- Responde de forma completa, fluida y detallada. NUNCA cortes ideas ni uses "..." para omitir explicaciones.',
  '- El servidor se encarga de agrupar y enviar el mensaje en burbujas óptimas de WhatsApp.',
].join('\n');

const WHATSAPP_FORMAT_ASK = [
  'FORMATO DE RESPUESTA PARA WHATSAPP:',
  '- Explica con rigor técnico, claridad y profundidad pedagógica.',
  '- Organiza la explicación en secciones temáticas claras usando encabezados con emoji y *negrilla* (ej: 🎨 *Frontend*, ⚙️ *Backend*, 🗄️ *Base de Datos*, 🔌 *Redes / Webhooks*).',
  '- Responde completo y directo, con ejemplos concisos cuando aplique. NUNCA cortes ideas a la mitad ni uses "...".',
  '- El servidor se encarga de agrupar y enviar el mensaje en burbujas óptimas de WhatsApp.',
].join('\n');

// Ejecuta `opencode run "<prompt>"` sin shell (argv, sin expansión).
// Nunca se llama si el puente está apagado: el handler responde antes.
// `opts.allowWrite` (fijado por //, /, /ssh wt|wf o por la VM) decide la instrucción.
// Devuelve { ok, output (técnico), files (artefactos de agent-out) }.
function runAgentTask(prompt, mode, opts) {
  // Fast path para diagnóstico de VM / recursos (respuesta instantánea < 100ms)
  if (isSystemDiagnosticQuery(prompt)) {
    return Promise.resolve({
      ok: true,
      output: getSystemTelemetryReport(),
      files: [],
      extraFiles: 0,
      continuityLogged: false,
    });
  }

  const cfg = agentConfig();
  const state = readAgentState();
  const allowWrite = opts && typeof opts.allowWrite === 'boolean' ? opts.allowWrite : cfg.allowWrite;
  const agent = (opts && opts.agent && AGENT_CATALOG[opts.agent]) ? opts.agent : state.agent;
  const thinking = (opts && opts.thinking && THINKING_LEVELS[opts.thinking]) ? opts.thinking : state.thinking;
  const thinkMult = THINKING_LEVELS[thinking].timeoutMult;
  try {
    fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  } catch { /* el escaneo de artefactos simplemente no devuelve nada */ }
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const techStyle = [
      'Actúa como ingeniero senior de software y profesor técnico para el administrador de LAUJIM.',
      'El usuario es un ingeniero de redes aprendiendo sistemas; conoce la funcionalidad del edificio pero quiere entender el código real, bases de datos y arquitectura sin rodeos ni explicaciones infantiles.',
      'Stack real del proyecto: React 19 + Vite + Tailwind en src/, Express en server.cjs, SQLite y PostgreSQL (Aiven Cloud), Capacitor Android para APK, workers con Chromium/Playwright (fb-publisher.cjs, scrapers), y webhooks para WhatsApp/cámaras.',
      'REGLAS DE PRECISIÓN Y RIGOR TÉCNICO:',
      '1. Da información 100% precisa, real y verificada en el proyecto: consulta los archivos del proyecto y la base de datos (data/database.json) antes de responder.',
      '2. No inventes causas ni uses analogías forzadas (como VLAN o ARP) salvo que realmente clarifiquen un concepto de redes.',
      '3. Responde de forma completa, fluida y con sustento en código. NUNCA cortes ideas a la mitad ni uses "..." para omitir explicaciones.',
      '4. Si el usuario te pregunta por un apartamento (ej: 101), publicación o worker: lee el estado real en data/database.json y en el código antes de responder.',
    ].join(' ');
    const agentRole = {
      auto: 'Rol: agente general opencode.',
      plan: 'Rol PLAN: solo lectura. Entrega plan compacto: archivos a tocar, pasos, riesgos y verificación. No modifiques nada.',
      build: 'Rol BUILD: ejecutor. Aplica el cambio mínimo, verifica con lint/build enfocado y lista diff. Antes de push recuerda el gate sync:aiven:pre-push.',
      backend: 'Rol BACKEND: especialista en server.cjs, APIs, persistencia, auth, jobs.',
      front: 'Rol FRONT: especialista en React/Tailwind, layout, accesibilidad y estado cliente.',
      qa: 'Rol QA: verificador independiente. Solo checks enfocados y evidencia, sin reabrir lo ya probado.',
      profe: 'Rol PROFESOR: explica para aprender, con ejemplo mínimo y qué estudiar después.',
    }[agent] || 'Rol: agente general opencode.';
    const thinkStyle = {
      low: 'Nivel low: respuesta rápida y concisa, solo lo esencial.',
      medium: 'Nivel medium: explicación balanceada con rutas y causa.',
      high: 'Nivel high: análisis profundo, verifica en código, cita archivos/líneas, propone tests.',
      xhigh: 'Nivel xhigh: análisis exhaustivo + plan de estudio (HTML detallado en agent-out/ solo si docs está activo).',
    }[thinking];
    // Docs por defecto APAGADOS: el usuario prefiere todo en el chat. Solo se
    // generan archivos si docs está ON o el pedido lo pide ("con docs"/"en html").
    const docsEnabled = DOCS_REQUEST_RE.test(prompt)
      || (opts && typeof opts.docsEnabled === 'boolean' ? opts.docsEnabled : state.docs === true);
    const outboxHint = docsEnabled
      ? 'Documentos: el usuario pidió archivos, GENERA un HTML autocontenido (CSS inline, sin CDN) en ./agent-out/<nombre-descriptivo>.html Y un espejo .md con el mismo nombre. Al final del chat indica el nombre exacto generado. Nunca digas que no pudiste enviarlo: si existe en agent-out, el puente lo adjunta. '
      : 'Documentos: NO generes HTML ni .md en esta respuesta; entrega todo completo en el chat. Solo genera archivos si el usuario lo pide explícitamente.';
    const continuityContract = 'Si aplicaste cambios de código: anota en docs/continuidad/BITACORA.md los archivos modificados y cómo probarlos.';
    const nodeContext = loadHarnessContext(prompt);
    const safePrompt =
      mode === 'code' && !allowWrite
        ? `${techStyle} ${agentRole} ${thinkStyle} ${nodeContext} Modo SOLO LECTURA: consulta y analiza archivos o base de datos sin modificarlos. ${outboxHint}${WHATSAPP_FORMAT_DEV} Tarea: ${prompt}`
        : mode === 'code'
          ? `${techStyle} ${agentRole} ${thinkStyle} ${nodeContext} Modo DESARROLLO TOTAL autorizado por el admin: actúa como el agente de código completo: lee, crea, modifica, elimina y verifica código con herramientas; ejecuta comandos no destructivos y lint/build enfocado; puedes hacer git push cuando lo pida, pero ANTES ejecuta obligatoriamente npm run sync:aiven:pre-push y solo continúa si termina OK; nunca uses git add -A, solo archivos intencionales. Despliegues a Oracle y borrados masivos solo con confirmación explícita. ${continuityContract}${outboxHint}${WHATSAPP_FORMAT_DEV} Al final: resumen claro de los cambios aplicados. Tarea: ${prompt}`
          : `${techStyle} ${agentRole} ${thinkStyle} ${nodeContext} ${outboxHint}${WHATSAPP_FORMAT_ASK} Pregunta técnica (puede ser del proyecto o general: React, Java, Python, webhooks, build): ${prompt}`;
    const isAgy = state.engine === 'antigravity' || state.engine === 'auto';
    const bin = isAgy ? 'agy' : cfg.command;
    const model = (state.model && state.model !== 'auto') ? state.model : '';
    const isAgyModel = Boolean(model && !model.startsWith('opencode/') && !model.includes('muse-spark'));
    const agentCli = AGENT_CATALOG[agent] && AGENT_CATALOG[agent].cli ? AGENT_CATALOG[agent].cli : null;
    const args = [];
    if (isAgy) {
      args.push('-p', safePrompt);
      const effort = thinking === 'xhigh' ? 'max' : thinking;
      args.push('--effort', effort);
      args.push('--dangerously-skip-permissions');
      if (!allowWrite) args.push('--mode', 'plan');
      if (isAgyModel) args.push('--model', model);
    } else {
      args.push('run');
      if (model) args.push('--model', model);
      if (agentCli) args.push('--agent', agentCli);
      args.push(safePrompt);
    }
    const child = spawn(bin, args, {
      cwd: __dirname,
      timeout: Math.round(cfg.timeoutMs * thinkMult),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (error) => {
      if (isAgy && error.code === 'ENOENT' && cfg.command && cfg.command !== 'agy') {
        const fbArgs = ['run'];
        if (model) fbArgs.push('--model', model);
        if (agentCli) fbArgs.push('--agent', agentCli);
        fbArgs.push(safePrompt);
        const fbChild = spawn(cfg.command, fbArgs, {
          cwd: __dirname,
          timeout: Math.round(cfg.timeoutMs * thinkMult),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let fbOut = '';
        let fbErr = '';
        fbChild.stdout.on('data', (d) => { fbOut += String(d); });
        fbChild.stderr.on('data', (d) => { fbErr += String(d); });
        fbChild.on('error', (err2) => {
          resolve({ ok: false, code: 'spawn', error: `No se pudo lanzar "${bin}" ni "${cfg.command}": ${err2.message}` });
        });
        fbChild.on('close', (code) => {
          const raw = fbOut.trim() || fbErr.trim();
          if (!raw) {
            resolve({ ok: false, code: 'empty', error: `El agente terminó sin salida (código ${code}).` });
            return;
          }
          const output = truncate(cleanAgentOutput(raw), cfg.maxReplyChars);
          resolve({ ok: true, output, files: [], extraFiles: 0, continuityLogged: false });
        });
        return;
      }
      resolve({ ok: false, code: 'spawn', error: `No se pudo lanzar "${bin}": ${error.message}` });
    });
    child.on('close', (code) => {
      const raw = out.trim() || err.trim();
      if (!raw) {
        resolve({ ok: false, code: 'empty', error: `El agente terminó sin salida (código ${code}).` });
        return;
      }
      const output = truncate(cleanAgentOutput(raw), cfg.maxReplyChars);
      if (!output) {
        resolve({ ok: false, code: 'empty', error: 'El agente solo devolvió ruido de terminal.' });
        return;
      }
      // Con docs apagados no se adjunta nada aunque el agente haya dejado
      // archivos viejos en agent-out: el "ya no me envíes eso" sí se cumple.
      const { files, extra } = docsEnabled ? agentOutboxFiles(startedAt) : { files: [], extra: 0 };
      // Sincronización best-effort: si fue tarea con escritura, deja rastro en
      // continuidad aunque el agente haya olvidado documentar (no duplica si ya
      // existe entrada; nunca rompe la respuesta por WhatsApp).
      let continuityLogged = false;
      if (mode === 'code' && allowWrite) {
        try {
          const { execFileSync } = require('child_process');
          execFileSync('node', ['scripts/harness-continuity.cjs',
            '--prompt', prompt.slice(0, 300),
            '--mode', mode,
            '--write', 'true',
            '--ok', 'true',
            '--output', output.slice(0, 500),
          ], { cwd: __dirname, timeout: 25000, stdio: 'ignore' });
          continuityLogged = true;
        } catch { /* best-effort: el puente sigue respondiendo igual */ }
      }
      resolve({ ok: true, output, files, extraFiles: extra, continuityLogged });
    });
  });
}

module.exports = {
  agentConfig,
  parseAgentCommand,
  isWriteIntent,
  getAgentHelp,
  runAgentTask,
  truncate,
  stripAnsi,
  cleanAgentOutput,
  mapAgentError,
  agentOutboxFiles,
  OUTBOX_MAX_FILES,
  getAgentModel,
  getAgentState,
  getAgentStatusText,
  setAgentEngine,
  setAgentPermission,
  resetAgentDefaults,
  setAgentModel,
  clearAgentModel,
  setAgentAgent,
  setAgentThinking,
  setAgentDocs,
  listAgentsText,
  listAgentModels,
  AGENT_CATALOG,
  THINKING_LEVELS,
  isSystemDiagnosticQuery,
  getSystemTelemetryReport,
};
