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

  // 2. Regenerar app-version.json
  run(process.execPath, ['scripts/generate-version.js'], root);

  // 3. Reconstruir la APK
  run(process.execPath, ['scripts/build-apk.cjs'], root);

  // 4. Archivar snapshot histórico del grafo (para rollback/consulta de versiones pasadas)
  run(process.execPath, ['scripts/archive-graph.cjs', '--label', `v${next}`], root);

  // 5. Gate de pre-push (verifica Aiven y sube data/database.json si hay cambio intencional)
  run('npm.cmd', ['run', 'sync:aiven:pre-push'], root);

  // 6. Commit y push
  const commitMessage = message || `build: publish APK ${next}`;
  const files = [
    'android/app/build.gradle',
    'public/app-version.json',
    'public/app-debug.apk',
  ];
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
