import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist');
const verFile = join(dist, 'version.json');
const publicDir = join(__dirname, '..', 'public');
const androidGradle = join(__dirname, '..', 'android', 'app', 'build.gradle');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const buildBase = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
let apkVersion = '1.0.0';
try {
  const gradle = readFileSync(androidGradle, 'utf-8');
  apkVersion = gradle.match(/versionName\s*=\s*["']([^"']+)["']/)?.[1] || apkVersion;
} catch {}
const versionParts = apkVersion.split('.').map(value => Number(value) || 0);
const patch = versionParts[2] || 0;

const version = {
  version: apkVersion,
  build: buildBase,
  patch,
  date: now.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }),
  time: now.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' }),
};

if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });

writeFileSync(verFile, JSON.stringify(version, null, 2));
const appVersion = {
  version: apkVersion,
  apkUrl: `https://laujim-app.onrender.com/app-debug.apk?v=${encodeURIComponent(apkVersion)}`,
};
const appVersionJson = `${JSON.stringify(appVersion, null, 2)}\n`;
writeFileSync(join(publicDir, 'app-version.json'), appVersionJson);
writeFileSync(join(dist, 'app-version.json'), appVersionJson);
console.log(`Version: ${version.version} (build ${version.build}) ${version.date} ${version.time}`);
