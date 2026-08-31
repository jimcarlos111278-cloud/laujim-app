import { mkdirSync, copyFileSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const dataDir = join(root, 'data');
const backupDir = join(root, 'backups');

if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true });
}

const now = new Date();
const timestamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  'T',
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
  String(now.getSeconds()).padStart(2, '0'),
].join('');

const src = join(dataDir, 'database.json');
const dst = join(backupDir, `database-${timestamp}.json`);

if (!existsSync(src)) {
  console.error('ERROR: No se encuentra data/database.json');
  process.exit(1);
}

copyFileSync(src, dst);
console.log(`Backup creado: backups/database-${timestamp}.json`);

// Keep last 30 backups, remove older ones
import { readdirSync, unlinkSync } from 'fs';
const files = readdirSync(backupDir)
  .filter(f => f.startsWith('database-') && f.endsWith('.json'))
  .sort()
  .reverse();

if (files.length > 30) {
  files.slice(30).forEach(f => {
    unlinkSync(join(backupDir, f));
    console.log(`  Eliminado backup antiguo: ${f}`);
  });
}

console.log(`Total backups: ${Math.min(files.length, 30)}`);
