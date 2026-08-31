const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const npxCommand = isWindows ? 'npx.cmd' : 'npx';
const gradleCommand = isWindows ? 'gradlew.bat' : './gradlew';

function javaMajor(javaHome) {
  const java = path.join(javaHome, 'bin', isWindows ? 'java.exe' : 'java');
  if (!fs.existsSync(java)) return 0;
  const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const match = output.match(/version\s+["'](\d+)/i);
  return match ? Number(match[1]) : 0;
}

function addCandidate(candidates, value) {
  if (!value) return;
  const resolved = path.resolve(value.trim().replace(/^"|"$/g, ''));
  if (!candidates.includes(resolved)) candidates.push(resolved);
}

function findJdk21() {
  const candidates = [];
  addCandidate(candidates, process.env.JAVA_HOME);

  const javaCommands = isWindows ? ['javac.exe', 'java.exe'] : ['javac', 'java'];
  for (const command of javaCommands) {
    try {
      const output = execFileSync(isWindows ? 'where.exe' : 'which', [command], { encoding: 'utf8' });
      for (const line of output.split(/\r?\n/).filter(Boolean)) {
        addCandidate(candidates, path.dirname(path.dirname(line)));
      }
    } catch {}
  }

  if (isWindows) {
    for (const parent of ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java']) {
      try {
        for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
          if (entry.isDirectory() && /^jdk-/i.test(entry.name)) addCandidate(candidates, path.join(parent, entry.name));
        }
      } catch {}
    }
  }

  return candidates.find(candidate => javaMajor(candidate) >= 21) || null;
}

function run(command, args, cwd, env) {
  console.log('');
  console.log(`[apk] ${command} ${args.join(' ')}`);
  const needsWindowsShell = isWindows && /\.(?:cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: needsWindowsShell });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`El comando terminó con código ${result.status}: ${command}`);
}

const javaHome = findJdk21();
if (!javaHome) {
  throw new Error('No se encontró un JDK 21. Instala JDK 21 o configura JAVA_HOME apuntando a su carpeta.');
}

const env = { ...process.env, JAVA_HOME: javaHome };
const javaBin = path.join(javaHome, 'bin');
const existingPath = process.env.PATH || process.env.Path || '';
const mergedPath = `${javaBin}${path.delimiter}${existingPath}`;
// Windows may expose PATH as `Path` to Node. Keep both spellings so npm,
// npx and the Android SDK remain available after selecting the JDK.
env.PATH = mergedPath;
if (isWindows) env.Path = mergedPath;
console.log(`[apk] JDK seleccionado: ${javaHome} (Java ${javaMajor(javaHome)})`);

// Graphify is useful for development/server builds, but it is not required
// to package the already-built web app into Capacitor. Skipping it here also
// prevents a slow scan of Android/OneDrive caches during every APK build.
run(npmCommand, ['run', 'build:apk-assets'], root, env);
run(process.execPath, ['scripts/prepare-capacitor-assets.js'], root, env);
run(npxCommand, ['cap', 'copy', 'android'], root, env);
run(gradleCommand, ['assembleDebug', '--no-daemon', '--console=plain'], path.join(root, 'android'), env);
run(process.execPath, ['scripts/copy-apk.js'], root, env);

const apkPath = path.join(root, 'dist', 'app-debug.apk');
if (!fs.existsSync(apkPath)) throw new Error(`No se generó la APK en ${apkPath}`);
const sizeMb = (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(2);
console.log(`[apk] APK generada: ${apkPath} (${sizeMb} MB)`);
