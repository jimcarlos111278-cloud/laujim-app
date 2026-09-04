// Starts a dedicated Google Chrome session for the browser MCP on demand.
// It deliberately uses its own profile so personal Chrome tabs are never
// inspected, reused, or closed by OpenCode.
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import net from 'net';

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9222;
const LAUJIM_URL = 'https://laujim-app.onrender.com/dashboard';
const BROWSER_TOOL_PREFIXES = ['chrome-devtools_', 'puppeteer_'];

let browserStartPromise = null;

function chromeCandidates() {
  return [
    process.env.CHROME_PATH,
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
}

function findChrome() {
  return chromeCandidates().find(path => existsSync(path)) || null;
}

function isCdpListening() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: CDP_HOST, port: CDP_PORT });
    const finish = value => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

async function ensureChromeCdp() {
  if (await isCdpListening()) return;

  const chrome = findChrome();
  if (!chrome) {
    console.warn('[browser] Google Chrome no encontrado; CDP no puede iniciarse automáticamente.');
    return;
  }

  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const profile = join(localAppData, 'Laujim', 'chrome-cdp');
  mkdirSync(profile, { recursive: true });

  const child = spawn(chrome, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    LAUJIM_URL,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt++) {
    if (await isCdpListening()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  console.warn('[browser] Chrome inició, pero el puerto CDP aún no responde.');
}

export default async () => ({
  'tool.execute.before': async input => {
    if (!BROWSER_TOOL_PREFIXES.some(prefix => String(input.tool || '').startsWith(prefix))) return;
    if (!browserStartPromise) browserStartPromise = ensureChromeCdp();
    await browserStartPromise;
  },
});
