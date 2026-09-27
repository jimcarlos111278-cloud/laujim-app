const fs = require('fs');
const path = require('path');

// Cargar .env automáticamente
for (const loc of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env'), '/home/ubuntu/laujim-app/.env', '/app/.env']) {
  if (fs.existsSync(loc)) {
    const lines = fs.readFileSync(loc, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
    break;
  }
}

const { TruecallerProvider } = require('../lib/caller-id/truecaller-provider.cjs');
const { normalizePhone } = require('../lib/caller-id/phone-normalizer.cjs');

async function main() {
  const rawPhone = process.argv[2];
  if (!rawPhone) {
    console.error('Uso: node scripts/truecaller-smoke.cjs <NUMERO_TELEFONICO>');
    console.error('Ejemplo: node scripts/truecaller-smoke.cjs +573001234567');
    process.exit(1);
  }

  const normalized = normalizePhone(rawPhone);
  if (!normalized) {
    console.error(`Error: El número "${rawPhone}" no pudo normalizarse como teléfono colombiano válido.`);
    process.exit(1);
  }

  console.log(`[Smoke Test] Consultando número normalizado: ${normalized}`);
  const provider = new TruecallerProvider();

  if (!provider.isConfigured()) {
    console.warn('[Smoke Test] AVISO: TRUECALLER_INSTALLATION_ID no está configurado en las variables de entorno.');
    console.warn('Configúralo en tu .env o ejecuta: $env:TRUECALLER_INSTALLATION_ID="tu_id"; node scripts/truecaller-smoke.cjs ' + normalized);
  }

  try {
    const result = await provider.lookup(normalized);
    console.log('\n--- Resultado de Truecaller ---');
    console.log(JSON.stringify({
      status: result.status,
      possibleName: result.possibleName ?? null,
      alternateName: result.alternateName ?? null,
      category: result.category ?? null,
      spamScore: result.spamScore ?? null,
      reportCount: result.reportCount ?? null,
      location: result.location ?? null,
      hasAvatar: Boolean(result.avatarUrl),
      hasEmail: Boolean(result.email)
    }, null, 2));
    console.log('\n[Smoke Test] ¡Consulta completada con éxito!');
  } catch (error) {
    console.error('\n--- Error al consultar Truecaller ---');
    console.error(JSON.stringify({
      code: error.code || 'UNEXPECTED',
      status: error.status || null,
      message: error.message
    }, null, 2));
    process.exitCode = 1;
  }
}

main();
