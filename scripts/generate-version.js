import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist');
const verFile = join(dist, 'version.json');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const buildBase = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
const major = 1, minor = 0;
let patch = 0;

let prev = null;
try { prev = JSON.parse(readFileSync(verFile, 'utf-8')); } catch {}

if (prev && prev.build) {
  const prevPatch = prev.patch || 0;
  patch = Number(prevPatch) + 1;
} else {
  patch = 1;
}

const version = {
  version: `${major}.${minor}.${patch}`,
  build: buildBase,
  patch,
  date: now.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }),
  time: now.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' }),
};

if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

writeFileSync(verFile, JSON.stringify(version, null, 2));
console.log(`Version: ${version.version} (build ${version.build}) ${version.date} ${version.time}`);
