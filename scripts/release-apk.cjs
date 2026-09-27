#!/usr/bin/env node
/**
 * release-apk.cjs
 *
 * Estandariza el flujo de publicación de una nueva APK:
 *   1. Bump de versión (patch) en android/app/build.gradle
 *   2. Regenera app-version.json (para que la APK vieja detecte la actualización)
 *   3. Reconstruye la APK (vite + capacitor + gradle)
 *   4. Archiva un snapshot histórico del grafo de conocimiento (graphify-out/archive/)
 *   5. Ejecuta el gate de pre-push (sync:aiven:pre-push)
 *   6. Commit y push a origin/main
 *
 * Uso:
 *   node scripts/release-apk.cjs [--message "mensaje del commit"] [--no-push]
 *
 * Opciones:
 *   --message "..."   Mensaje del commit (por defecto: "build: publish APK <version>")
 *   --no-push         Solo construye y commitea, no hace push
 *   --patch|--minor|--major   Tipo de bump (por defecto: patch)
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const gradleFile = path.join(root, 'android', 'app', 'build.gradle');
const versionFile = path.join(root, 'public', 'app-version.json');

function run(command, args, cwd, env) {
  console.log(`\n[release] ${command} ${args.join(' ')}`);
  const needsWindowsShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: needsWindowsShell });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`El comando terminó con código ${result.status}: ${command}`);
  return result;
}

function readVersion() {
  const gradle = fs.readFileSync(gradleFile, 'utf8');
  const match = gradle.match(/versionName\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error('No se encontró versionName en build.gradle');
  return match[1];
}

function bumpVersion(current, type) {
  const parts = current.split('.').map(n => Number(n) || 0);
  if (type === 'major') { parts[0] += 1; parts[1] = 0; parts[2] = 0; }
  else if (type === 'minor') { parts[1] += 1; parts[2] = 0; }
  else { parts[2] += 1; }
  return parts.join('.');
}

function setVersion(version) {
  let gradle = fs.readFileSync(gradleFile, 'utf8');
  gradle = gradle.replace(/versionName\s*=\s*["'][^"']+["']/, `versionName = "${version}"`);
  fs.writeFileSync(gradleFile, gradle);
  console.log(`[release] versionName actualizado a ${version} en build.gradle`);
}

function main() {
  const args = process.argv.slice(2);
  const messageIdx = args.indexOf('--message');
  const message = messageIdx >= 0 ? args[messageIdx + 1] : null;
  const noPush = args.includes('--no-push');
  const bumpType = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch';

  const current = readVersion();
  const next = bumpVersion(current, bumpType);
  console.log(`[release] Versión actual: ${current} -> ${next} (${bumpType})`);

  // 1. Bump de versión
  setVersion(next);

  // 2. Reconstruir la APK
  run(process.execPath, ['scripts/build-apk.cjs'], root);

  // 3. Archivar APK versionada en public/releases (máx. 10: se elimina la más vieja).
  //    Las APK no se commitean a git (ver .gitignore); a la VM llegan con el deploy.
  const releasesDir = path.join(root, 'public', 'releases');
  fs.mkdirSync(releasesDir, { recursive: true });
  const builtApk = path.join(root, 'public', 'app-debug.apk');
  if (!fs.existsSync(builtApk)) throw new Error('No se generó public/app-debug.apk');
  fs.copyFileSync(builtApk, path.join(releasesDir, `laujim-v${next}.apk`));
  console.log(`[release] APK archivada en public/releases/laujim-v${next}.apk`);
  const kept = fs.readdirSync(releasesDir)
    .filter(f => /^laujim-v.*\.apk$/i.test(f))
    .map(f => ({ f, mtime: fs.statSync(path.join(releasesDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of kept.slice(10)) {
    fs.unlinkSync(path.join(releasesDir, old.f));
    console.log(`[release] APK antigua eliminada: ${old.f}`);
  }

  // 4. Regenerar app-version.json apuntando a la APK versionada
  run(process.execPath, ['scripts/generate-version.js'], root, { ...process.env, LAUJIM_APK_FILE: `releases/laujim-v${next}.apk` });

  // 5. Archivar snapshot histórico del grafo (para rollback/consulta de versiones pasadas)
  run(process.execPath, ['scripts/archive-graph.cjs', '--label', `v${next}`], root);

  // 5b. Subir grafo a Aiven para consulta remota (no fatal: PCs sin Aiven continúan)
  try {
    run(process.execPath, ['scripts/sync-graph-aiven.cjs'], root);
  } catch (error) {
    console.log(`[release] Aviso: no se sincronizó el grafo a Aiven: ${error.message}`);
  }

  // 6. Gate de pre-push (verifica Aiven y sube data/database.json si hay cambio intencional)
  run('npm.cmd', ['run', 'sync:aiven:pre-push'], root);

  // 7. Commit y push (sin APKs: solo código + versión + grafo base)
  const commitMessage = message || `build: publish APK ${next}`;
  const files = [
    'android/app/build.gradle',
    'public/app-version.json',
    'public/icon.png',
    'capacitor.config.json',
    'graphify-out/graph.json',
    'graphify-out/GRAPH_REPORT.md',
    'graphify-out/manifest.json',
    'graphify-out/.graphify_labels.json',
    'android/app/src/main/res',
    'android/app/src/main/java/com/laujim/aptmanager/MainActivity.java',
    'README.md',
    'server.cjs',
    'scripts/build-apk.cjs',
    'scripts/release-apk.cjs',
    'src/App.jsx',
    'src/api.js',
    'src/pages/Login.jsx',
    'src/pages/MiApto.jsx',
    'src/pages/ScraperWorker.jsx',
    'src/pages/SecurityCenter.jsx',
    'deploy-oracle-vm/ezviz_stream_server.py',
    'src/pages/Utilities.jsx',
    'src/pages/WhatsAppInbox.jsx',
    'src/index.css',
    'src/utils/auth.js',
    'src/utils/portableWorker.js',
  ].filter(f => fs.existsSync(path.join(root, f)));
  run('git', ['add', ...files], root);
  run('git', ['commit', '-m', commitMessage], root);

  if (noPush) {
    console.log(`\n[release] Commit creado (sin push). Versión ${next} lista.`);
  } else {
    run('git', ['push', 'origin', 'main'], root);
    console.log(`\n[release] APK ${next} publicada y pusheada.`);
  }
}

main();
