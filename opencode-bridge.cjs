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
const OUTBOX_MAX_FILES = 2;
const OUTBOX_MAX_BYTES = 10 * 1024 * 1024;

const MAX_PROMPT_CHARS = 2000;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_REPLY_CHARS = 1500;

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
const IA_MODELOS_RE = /^ia\s+modelos$/i;
const IA_MODELO_RE = /^ia\s+modelo(?:\s+(.+))?$/is;
// Override del modelo fijado por WhatsApp (manda sobre OPENCODE_AGENT_MODEL).
const MODEL_FILE = path.join(__dirname, 'agent-model.json');
const MODEL_ID_RE = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i;
const MAX_MODEL_ID_CHARS = 100;
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
      200,
      Number(process.env.OPENCODE_AGENT_MAX_REPLY_CHARS || DEFAULT_MAX_REPLY_CHARS) ||
        DEFAULT_MAX_REPLY_CHARS,
    ),
  };
}

// Devuelve { mode: 'code'|'ask'|'help'|'menu'|'model'|'models', prompt, write }
// o null si no es comando agente. `write` es true/false cuando el mensaje lo
// fija con //, /, /ssh wt|wf, o null para usar el default de la VM.
function parseAgentCommand(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (HELP_RE.test(value)) return { mode: 'help', prompt: '', write: null };
  if (IA_MENU_RE.test(value)) return { mode: 'menu', prompt: '', write: null };
  if (IA_MODELOS_RE.test(value)) return { mode: 'models', prompt: '', write: null };
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
    '🤖 *Agente IA por WhatsApp* (solo admin)',
    '',
    '• Escribe `IA` → menú: lectura, escritura o pregunta general',
    '• `/ <petición>` → solo lectura (consultas, no toca nada)',
    '• `// <petición>` → con escritura (puede modificar archivos)',
    '• En cualquier modo: consultas, preguntas de lo que sea, generar HTML, imágenes y archivos (te los envío por aquí)',
    '',
    'Modelos:',
    '• `IA modelo` → ver el modelo actual',
    '• `IA modelo proveedor/modelo` → cambiarlo (ej: `IA modelo opencode/big-pickle`)',
    '• `IA modelo auto` → volver al modelo por defecto de la VM',
    '• `IA modelos` → listar modelos disponibles',
    '',
    'Ejemplos:',
    '• `/ dime si la sección automática de facebook funciona`',
    '• `// corrige el texto del menú de cobros`',
    '• `IA` → eliges modo y luego hablas directo, sin prefijos',
    '',
    'Atajos anteriores que siguen funcionando: `/ssh wf`, `/ssh wt`, `code:`, `pregunta:`. `SALIR` cierra el modo.',
  ].join('\n');
}

// ─── Modelo configurable por WhatsApp (solo admin) ────────────────────────
// Precedencia: override por WhatsApp (agent-model.json) > OPENCODE_AGENT_MODEL
// > modelo por defecto de opencode.
function getAgentModel() {
  try {
    const raw = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
    const fromFile = String(raw && raw.model || '').trim();
    if (fromFile && MODEL_ID_RE.test(fromFile)) return fromFile;
  } catch { /* sin override: se usa el env/default */ }
  const fromEnv = String(process.env.OPENCODE_AGENT_MODEL || '').trim();
  if (fromEnv && MODEL_ID_RE.test(fromEnv)) return fromEnv;
  return '';
}

function setAgentModel(id) {
  const value = String(id || '').trim().slice(0, MAX_MODEL_ID_CHARS);
  if (!MODEL_ID_RE.test(value)) {
    return { ok: false, error: 'Formato inválido. Usa `proveedor/modelo` (ej: `IA modelo opencode/big-pickle`).' };
  }
  try {
    fs.writeFileSync(MODEL_FILE, JSON.stringify({ model: value, updatedAt: new Date().toISOString() }), 'utf8');
  } catch (error) {
    return { ok: false, error: `No pude guardar el modelo: ${error.message}` };
  }
  return { ok: true, model: value };
}

function clearAgentModel() {
  try { fs.unlinkSync(MODEL_FILE); } catch { /* ya estaba en default */ }
  const fallback = String(process.env.OPENCODE_AGENT_MODEL || '').trim();
  return fallback || '(default de opencode)';
}

function listAgentModels() {
  const cfg = agentConfig();
  return new Promise((resolve) => {
    const child = spawn(cfg.command, ['models'], {
      cwd: __dirname,
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.on('error', (error) => {
      resolve({ ok: false, error: `No se pudo lanzar "${cfg.command}": ${error.message}` });
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
  '.pdf': 'application/pdf', '.html': 'text/html', '.txt': 'text/plain', '.md': 'text/markdown',
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
  return `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

// Ejecuta `opencode run "<prompt>"` sin shell (argv, sin expansión).
// Nunca se llama si el puente está apagado: el handler responde antes.
// `opts.allowWrite` (fijado por //, /, /ssh wt|wf o por la VM) decide la instrucción.
// Devuelve { ok, output (lenguaje humano), files (artefactos de agent-out) }.
function runAgentTask(prompt, mode, opts) {
  const cfg = agentConfig();
  const allowWrite = opts && typeof opts.allowWrite === 'boolean' ? opts.allowWrite : cfg.allowWrite;
  try {
    fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  } catch { /* el escaneo de artefactos simplemente no devuelve nada */ }
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const humanStyle = 'Responde SIEMPRE en español coloquial, máximo 15 líneas, SIN códigos de terminal, SIN mostrar comandos internos, rutas crudas ni trazas de herramientas: solo el resultado explicado para una persona no técnica. ';
    const outboxHint = 'Si generas archivos (HTML, imágenes, documentos), guárdalos en ./agent-out/ con un nombre descriptivo. ';
    const safePrompt =
      mode === 'code' && !allowWrite
        ? `Modo solo lectura: no modifiques archivos ni ejecutes nada destructivo. ${humanStyle}${outboxHint}Tarea: ${prompt}`
        : mode === 'code'
          ? `Modo escritura permitido por el administrador: puedes modificar archivos del proyecto si la tarea lo pide. ${humanStyle}${outboxHint}Al final lista qué cambiaste. Tarea: ${prompt}`
          : `${humanStyle}Pregunta (puede ser de cualquier tema, no solo del proyecto): ${prompt}`;
    const model = getAgentModel();
    const args = model
      ? ['run', '--model', model, safePrompt]
      : ['run', safePrompt];
    const child = spawn(cfg.command, args, {
      cwd: __dirname,
      timeout: cfg.timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (error) => {
      resolve({ ok: false, code: 'spawn', error: `No se pudo lanzar "${cfg.command}": ${error.message}` });
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
      const { files, extra } = agentOutboxFiles(startedAt);
      resolve({ ok: true, output, files, extraFiles: extra });
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
  setAgentModel,
  clearAgentModel,
  listAgentModels,
};
