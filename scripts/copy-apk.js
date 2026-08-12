import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist');
const publicDir = join(__dirname, '..', 'public');
const externalBuildRoot = process.env.LAUJIM_ANDROID_BUILD_ROOT;
const apkSrc = externalBuildRoot
  ? join(externalBuildRoot, 'app', 'outputs', 'apk', 'debug', 'app-debug.apk')
  : join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const apkDst = join(dist, 'app-debug.apk');
const publicApkDst = join(publicDir, 'app-debug.apk');

if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });

if (existsSync(apkSrc)) {
  copyFileSync(apkSrc, apkDst);
  copyFileSync(apkSrc, publicApkDst);
  console.log('APK copied to dist/app-debug.apk and public/app-debug.apk');
} else {
  console.log('APK not found at:', apkSrc);
}
