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
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_REPLY_CHARS = 3500;

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
const IA_AGENTES_RE = /^ia\s+agentes$/i;
const IA_AGENTE_RE = /^ia\s+agente(?:\s+(.+))?$/is;
const IA_THINKING_RE = /^ia\s+(?:thinking|pensamiento|think|nivel)(?:\s+(.+))?$/is;
const IA_ESTADO_RE = /^ia\s+(?:estado|status|config)$/i;
// Override del modelo fijado por WhatsApp (manda sobre OPENCODE_AGENT_MODEL).
const MODEL_FILE = path.join(__dirname, 'agent-model.json');
const MODEL_ID_RE = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i;
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
      200,
      Number(process.env.OPENCODE_AGENT_MAX_REPLY_CHARS || DEFAULT_MAX_REPLY_CHARS) ||
        DEFAULT_MAX_REPLY_CHARS,
    ),
  };
}

// Devuelve { mode: 'code'|'ask'|'help'|'menu'|'model'|'models'|'agent'|'agents'|'thinking'|'estado', prompt, write }
// o null si no es comando agente. `write` es true/false cuando el mensaje lo
// fija con //, /, /ssh wt|wf, o null para usar el default de la VM.
function parseAgentCommand(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (HELP_RE.test(value)) return { mode: 'help', prompt: '', write: null };
  if (IA_MENU_RE.test(value)) return { mode: 'menu', prompt: '', write: null };
  if (IA_ESTADO_RE.test(value)) return { mode: 'estado', prompt: '', write: null };
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
    'Modelo:',
    '• `IA estado` → ver modelo + agente + thinking actuales',
    '• `IA modelos` → listar modelos de la VM',
    '• `IA modelo proveedor/modelo` → fijarlo (ej: `IA modelo opencode/big-pickle`)',
    '• `IA modelo auto` → volver al default',
    '',
    'Agente (rol, como aquí):',
    '• `IA agentes` → ver catálogo (auto, plan, build, backend, front, qa, profe)',
    '• `IA agente build` → fija rol ejecutor; `IA agente profe` → modo profesor',
    '• `IA agente auto` → default de opencode',
    '',
    'Nivel de pensamiento:',
    '• `IA thinking medium` → low | medium | high | xhigh',
    '• low=rápido, medium=balanceado, high=profundo, xhigh=exhaustivo+HTML',
    '',
    'Documentos:',
    '• Si pides guía/ruta/reporte, lo genero en HTML autocontenido en `agent-out/` y te lo envío por aquí + resumen técnico en el chat.',
    '• El HTML además te llega con enlace para abrirlo como página real en el navegador (WhatsApp solo deja adjuntarlo como texto).',
    '',
    'Ejemplos:',
    '• `/ explica handleCloudAdminMessage con rutas y flujo`',
    '• `// corrige el texto del menú de cobros y lista cambios`',
    '• `pregunta: webhooks vs traps SNMP con ejemplo en server.cjs`',
    '',
    '`SALIR` cierra el modo. Atajos viejos siguen vivos: `/ssh wf`, `/ssh wt`, `code:`.',
  ].join('\n');
}

// ─── Estado configurable por WhatsApp (solo admin) ────────────────────────
// Precedencia: override por WhatsApp (agent-model.json) > env > default.
// El JSON guarda { model, agent, thinking }. agent-model.json se mantiene
// como nombre por compatibilidad aunque ya guarda las 3 cosas.
function readAgentState() {
  let state = {};
  try {
    const raw = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
    if (raw && typeof raw === 'object') state = raw;
  } catch { /* sin override */ }
  const model = String(state.model || process.env.OPENCODE_AGENT_MODEL || '').trim();
  const agent = String(state.agent || process.env.OPENCODE_AGENT || 'auto').trim().toLowerCase();
  const thinking = String(state.thinking || process.env.OPENCODE_THINKING || 'medium').trim().toLowerCase();
  return {
    model: MODEL_ID_RE.test(model) ? model : '',
    agent: AGENT_CATALOG[agent] ? agent : 'auto',
    thinking: THINKING_LEVELS[thinking] ? thinking : 'medium',
  };
}

function writeAgentState(patch) {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')) || {}; } catch { current = {}; }
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(MODEL_FILE, JSON.stringify(next), 'utf8');
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
  const modelTxt = s.model || '(default de opencode)';
  return [
    '🤖 *IA estado*',
    `• Modelo: ${modelTxt}`,
    `• Agente: ${s.agent} — ${AGENT_CATALOG[s.agent].desc}`,
    `• Thinking: ${s.thinking} — ${THINKING_LEVELS[s.thinking].desc}`,
    '',
    'Cambia con `IA modelo ...`, `IA agente ...`, `IA thinking ...`.',
  ].join('\n');
}

function setAgentModel(id) {
  const value = String(id || '').trim().slice(0, MAX_MODEL_ID_CHARS);
  if (!MODEL_ID_RE.test(value)) {
    return { ok: false, error: 'Formato inválido. Usa `proveedor/modelo` (ej: `IA modelo opencode/big-pickle`).' };
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

function listAgentsText() {
  return ['🤖 *Agentes disponibles*',
    ...Object.entries(AGENT_CATALOG).map(([k, v]) => `• \`${k}\` — ${v.desc}`),
    '',
    'Fija con `IA agente <nombre>` (ej: `IA agente build`).',
  ].join('\n');
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
  return `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

// ─── Contexto vivo del proyecto (como las demás sesiones) ────────────────
// El harness de WhatsApp corre `opencode run` aislado: sin esto no ve el
// grafo ni la memoria del proyecto y "habla raro". Se inyecta en cada tarea.
const CONTEXT_FILES = [
  { file: '.opencode/project-memory.md', max: 3000, label: 'Memoria del proyecto' },
  { file: '.opencode/session-memory.md', max: 3000, label: 'Memoria de sesiones' },
  { file: 'graphify-out/GRAPH_REPORT.md', max: 4000, label: 'Grafo de conocimiento' },
  { file: 'docs/continuidad/LEEME.md', max: 2000, label: 'Continuidad (cómo informar)' },
  { file: 'docs/continuidad/BITACORA.md', max: 2500, label: 'Bitácora (últimos cambios ejecutados)', tail: true },
  { file: 'docs/continuidad/PENDIENTES.md', max: 2000, label: 'Pendientes sin commitear' },
  { file: 'docs/continuidad/IDEAS.md', max: 1500, label: 'Ideas sin ejecutar' },
];

function loadHarnessContext() {
  const parts = [];
  for (const { file, max, label, tail } of CONTEXT_FILES) {
    try {
      const full = path.join(__dirname, file);
      const content = fs.readFileSync(full, 'utf8').trim();
      if (!content) continue;
      const shown = tail ? content.slice(-max) : content.slice(0, max);
      parts.push(`### ${label}\n${shown}`);
    } catch { /* archivo ausente: se omite sin romper */ }
  }
  if (!parts.length) return '';
  return `Contexto actualizado del proyecto (úsalo como verdad vigente, no lo repitas):\n${parts.join('\n\n')}\n`;
}

// ─── Formato WhatsApp bonito (siempre) ────────────────────────────────────
// El chat solo lleva resumen: el detalle completo va al HTML de agent-out.
const WHATSAPP_FORMAT_DEV = [
  'FORMATO OBLIGATORIO del mensaje de chat (WhatsApp, español técnico, sin coloquialismos):',
  'Empieza con una línea de titular en *negrilla*. Luego estas secciones, cada una separada por una línea en blanco:',
  '*Qué se hizo* (lista numerada 1. 2. 3., una línea por ítem, archivos exactos),',
  '*Qué falta* (numerada; si nada falta escribe "Nada pendiente"),',
  '*Verificar* (1-3 pasos cortos para comprobar).',
  'Máximo 25 líneas. Nada de bloques de código largos, rutas crudas sueltas ni trazas: el detalle va al HTML.',
].join(' ');
const WHATSAPP_FORMAT_ASK = [
  'FORMATO OBLIGATORIO del mensaje de chat (WhatsApp, español técnico, sin coloquialismos):',
  'Titular en *negrilla*, luego explicación con *negrilla* en los conceptos clave, listas numeradas y líneas en blanco entre secciones.',
  'Puedes explayarte lo necesario, pero ordenado y sin bloques de código gigantes: el ejemplo completo y el detalle van al HTML de agent-out.',
].join(' ');

// Ejecuta `opencode run "<prompt>"` sin shell (argv, sin expansión).
// Nunca se llama si el puente está apagado: el handler responde antes.
// `opts.allowWrite` (fijado por //, /, /ssh wt|wf o por la VM) decide la instrucción.
// Devuelve { ok, output (técnico), files (artefactos de agent-out) }.
function runAgentTask(prompt, mode, opts) {
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
      'Actúa como profesor de ingeniería de sistemas y ingeniero senior: español técnico, preciso, sin coloquialismos (prohibido: tranqui, compa, paisa, criollo, en cristiano).',
      'Perfil del usuario: ingeniero de redes aprendiendo sistemas. Ya domina el uso funcional de LAUJIM (arriendos, inquilinos, contratos, pagos). NO re-expliques lo funcional salvo que lo pida: ve directo al código con rutas, símbolos y flujos.',
      'Stack LAUJIM: React 19 + Vite + Tailwind, Node/Express en server.cjs, SQLite/Postgres/Aiven, Capacitor Android, webhooks estilo traps SNMP, Python para automatización, Java para lógica pesada/OOP/APIs.',
      'Reglas de respuesta: 1) causa técnica primero, 2) archivos y funciones exactas tocadas/leídas, 3) comandos y verificación, 4) riesgos. Usa términos correctos: componente, hook, estado, props, endpoint, middleware, payload, reintento idempotente.',
      'Analogías de redes solo como puente (VLAN≈componente, tabla ARP≈estado, trap SNMP≈webhook), manteniendo rigor.',
      'Tiempos: cuando pidan ruta/estimación, da tabla por niveles (con base / desde cero) en horas y semanas, más prerrequisitos y docs oficiales.',
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
      xhigh: 'Nivel xhigh: análisis exhaustivo + genera HTML detallado en agent-out/ + plan de estudio.',
    }[thinking];
    const outboxHint = 'Documentos: si el usuario pide guía, ruta, reporte o explicación larga, GENERA SIEMPRE un HTML autocontenido (CSS inline, sin CDN) en ./agent-out/<nombre-descriptivo>.html Y un espejo .md con el mismo nombre. Al final del chat indica el nombre exacto generado. Nunca digas que no pudiste enviarlo: si existe en agent-out, el puente lo adjunta. ';
    const continuityContract = 'Contrato de continuidad OBLIGATORIO al terminar (igual que PC/VM): 1) agrega entrada en docs/continuidad/BITACORA.md (fecha, origen harness-WhatsApp, qué/porqué, archivos exactos, cómo verificar, commit); 2) si quedó algo a medias anótalo en docs/continuidad/PENDIENTES.md, si fue idea no ejecutada en docs/continuidad/IDEAS.md; 3) ejecuta node scripts/continuidad.cjs; 4) git add solo intencional (nunca -A, jamás data/database.json salvo cambio intencional), commit, npm run sync:aiven:pre-push y solo si termina OK haces push (si falla o falta AIVEN_DATABASE_URL, detente e informa); el hook post-commit anota el commit en el grafo/Aiven. ';
    const nodeContext = loadHarnessContext();
    const safePrompt =
      mode === 'code' && !allowWrite
        ? `${techStyle} ${agentRole} ${thinkStyle} ${nodeContext} Modo SOLO LECTURA: no modifiques archivos ni ejecutes nada destructivo. ${outboxHint}${WHATSAPP_FORMAT_DEV} Tarea: ${prompt}`
        : mode === 'code'
          ? `${techStyle} ${agentRole} ${thinkStyle} ${nodeContext} Modo DESARROLLO TOTAL autorizado por el admin: actúa como el agente de código completo (igual que en una sesión opencode normal): lee, crea, modifica, elimina y verifica código con herramientas; ejecuta comandos no destructivos y lint/build enfocado; puedes hacer git push cuando lo pida, pero ANTES ejecuta obligatoriamente npm run sync:aiven:pre-push y solo continúa si termina OK (si falla o falta AIVEN_DATABASE_URL, detente e informa); nunca uses git add -A, solo archivos intencionales (jamás data/database.json salvo cambio intencional). Despliegues a Oracle y borrados masivos solo con confirmación explícita. ${continuityContract}${outboxHint}${WHATSAPP_FORMAT_DEV} Al final: resumen en el chat con el formato obligatorio + detalle en HTML. Tarea: ${prompt}`
          : `${techStyle} ${agentRole} ${thinkStyle} ${nodeContext} ${outboxHint}${WHATSAPP_FORMAT_ASK} Pregunta técnica (puede ser del proyecto o general: React, Java, Python, webhooks, build): ${prompt}`;
    const model = state.model;
    const agentCli = AGENT_CATALOG[agent] && AGENT_CATALOG[agent].cli ? AGENT_CATALOG[agent].cli : null;
    const args = ['run'];
    if (model) args.push('--model', model);
    if (agentCli) args.push('--agent', agentCli);
    args.push(safePrompt);
    const child = spawn(cfg.command, args, {
      cwd: __dirname,
      timeout: Math.round(cfg.timeoutMs * thinkMult),
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
  setAgentModel,
  clearAgentModel,
  setAgentAgent,
  setAgentThinking,
  listAgentsText,
  listAgentModels,
  AGENT_CATALOG,
  THINKING_LEVELS,
};
