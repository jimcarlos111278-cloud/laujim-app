import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();
const generatedApks = [
  join(projectRoot, 'dist', 'app-debug.apk'),
  join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'public', 'app-debug.apk'),
];

for (const apkPath of generatedApks) {
  if (existsSync(apkPath)) {
    unlinkSync(apkPath);
    console.log(`Removed stale APK from Capacitor assets: ${apkPath}`);
  }
}
