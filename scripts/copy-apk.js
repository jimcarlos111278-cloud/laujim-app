import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist');
const apkSrc = join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const apkDst = join(dist, 'app-debug.apk');

if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

if (existsSync(apkSrc)) {
  copyFileSync(apkSrc, apkDst);
  console.log('APK copied to dist/app-debug.apk');
} else {
  console.log('APK not found at:', apkSrc);
}
