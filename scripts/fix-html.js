import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlFile = join(__dirname, '..', 'dist', 'index.html');

let html = readFileSync(htmlFile, 'utf-8');

// Move script to end of body (after #root) so loading screen shows first
const scriptMatch = html.match(/<script src="\/(assets\/app\.[^.]+\.js)"><\/script>/);
if (scriptMatch) {
  const scriptTag = scriptMatch[0];
  html = html.replace(scriptTag, '');
  html = html.replace('</body>', scriptTag + '</body>');
}

writeFileSync(htmlFile, html, 'utf-8');
console.log('HTML fixed:', scriptMatch ? scriptMatch[1] : 'no script found');
