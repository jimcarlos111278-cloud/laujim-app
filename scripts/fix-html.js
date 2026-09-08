import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlFile = join(__dirname, '..', 'dist', 'index.html');

let html = readFileSync(htmlFile, 'utf-8');

// Move script to end of body (after #root) so loading screen shows first
const scriptMatch = html.match(/<script[^>]+src="\/(assets\/app\.[^.]+\.js)"[^>]*><\/script>/);
if (scriptMatch) {
  const scriptTag = scriptMatch[0];
  html = html.replace(scriptTag, '');
  html = html.replace('</body>', scriptTag + '</body>');
}

writeFileSync(htmlFile, html, 'utf-8');
console.log('HTML fixed:', scriptMatch ? scriptMatch[1] : 'no script found');

// Remove dist/app-debug.apk if present so Cloudflare's 25MB asset limit is not exceeded.
// APK downloads are redirected to Render via public/_redirects.
const distApk = join(__dirname, '..', 'dist', 'app-debug.apk');
if (existsSync(distApk)) {
  try {
    unlinkSync(distApk);
    console.log('Removed dist/app-debug.apk (exceeds Cloudflare 25MB limit; redirected via _redirects)');
  } catch (e) {
    console.warn('Could not remove dist/app-debug.apk:', e.message);
  }
}
