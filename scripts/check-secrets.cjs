#!/usr/bin/env node
/**
 * check-secrets.cjs
 *
 * Verifica que los secretos necesarios existan en el entorno (VM o cualquier PC).
 * Uso: node scripts/check-secrets.cjs [--strict]
 *
 * Solo imprime nombres y estado (presente/ausente). NUNCA imprime valores.
 * --strict: sale con código 1 si falta algún requerido (útil en deploy/CI).
 */
const REQUIRED = [
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  // Aiven: basta una de las dos.
  'AIVEN_DATABASE_URL|DATABASE_URL',
];

const OPTIONAL = [
  'ADMIN_RECOVERY_CODE',
  'SESSION_TTL_HOURS',
  'SCRAPER_WORKER_TOKEN',
  'EDGE_GATEWAY_URL',
  'EDGE_GATEWAY_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
  'PUBLIC_APK_BASE_URL',
  'TRUECALLER_COOKIE',
  'TRUECALLER_INSTALLATION_ID',
  'DB_PASSWORD',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_ADMIN_USERS',
];

function present(spec) {
  return spec.split('|').some(name => String(process.env[name] || '').trim().length > 0);
}

let missingRequired = [];
for (const spec of REQUIRED) {
  const ok = present(spec);
  console.log(`${ok ? 'OK      ' : 'FALTA   '} ${spec}`);
  if (!ok) missingRequired.push(spec);
}
console.log('--- opcionales ---');
for (const spec of OPTIONAL) {
  console.log(`${present(spec) ? 'ok      ' : 'ausente '} ${spec}`);
}

if (missingRequired.length > 0) {
  console.error(`\n[check-secrets] Faltan requeridos: ${missingRequired.join(', ')}`);
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('\n[check-secrets] Requeridos presentes.');
}
