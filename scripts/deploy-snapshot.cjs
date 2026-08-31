/**
 * Pre-deploy snapshot script.
 * Run BEFORE each deploy to persist runtime data in git.
 *
 * Usage: node scripts/deploy-snapshot.cjs
 *
 * This copies the runtime database from data/database.json into
 * backups/auto-latest.json and commits it so Render's fresh clone
 * has the latest data snapshot.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_FILE = path.join(__dirname, '..', 'data', 'database.json');
const BACKUP_FILE = path.join(__dirname, '..', 'backups', 'auto-latest.json');

if (!fs.existsSync(DATA_FILE)) {
  console.log('No runtime database found at ' + DATA_FILE);
  console.log('Nothing to snapshot.');
  process.exit(0);
}

fs.mkdirSync(path.dirname(BACKUP_FILE), { recursive: true });
fs.copyFileSync(DATA_FILE, BACKUP_FILE);
console.log('Copied data/database.json → backups/auto-latest.json');

try {
  execSync('git add -A && git commit -m "data snapshot pre-deploy"', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  console.log('Committed snapshot. Now run: git push');
} catch (e) {
  console.log('Git commit failed (maybe nothing to commit): ' + e.message);
}
