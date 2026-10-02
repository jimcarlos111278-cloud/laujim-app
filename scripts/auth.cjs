#!/usr/bin/env node
/**
 * scripts/auth.cjs
 *
 * Sistema de Autenticación de Dispositivos (Laujim Unified Cloud Gateway).
 * Gestiona sesiones temporales (efímeras en RAM/expiran) y permanentes en Aiven.
 *
 * Uso:
 *   node scripts/auth.cjs --temp             # Inicia sesión temporal (2 horas)
 *   node scripts/auth.cjs --permanent        # Autentica este PC de forma permanente
 *   node scripts/auth.cjs --logout           # Cierra sesión y desautoriza este PC
 *   node scripts/auth.cjs --revoke <id>      # Revoca un dispositivo remotamente
 *   node scripts/auth.cjs --list             # Lista dispositivos autorizados
 *   node scripts/auth.cjs --verify           # Verifica si este PC está autorizado
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const LOCAL_CRED_DIR = path.join(os.homedir(), '.laujim');
const LOCAL_CRED_FILE = path.join(LOCAL_CRED_DIR, 'auth.json');

const AIVEN_URL = process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL;
const MASTER_KEY_HASH = process.env.LAUJIM_MASTER_KEY_HASH || crypto.createHash('sha256').update('laujim2026').digest('hex');

function getPool() {
  const url = AIVEN_URL || (() => {
    try {
      const p = path.join(LOCAL_CRED_DIR, 'aiven.url');
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
    } catch {}
    return null;
  })();
  if (!url) {
    throw new Error('AIVEN_DATABASE_URL no está configurada.');
  }
  return new Pool({
    connectionString: url.replace(/sslmode=[^&]+&?/, ''),
    ssl: { rejectUnauthorized: false }
  });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken() {
  return 'ljm_' + crypto.randomBytes(24).toString('hex');
}

function getLocalCredentials() {
  try {
    if (fs.existsSync(LOCAL_CRED_FILE)) {
      return JSON.parse(fs.readFileSync(LOCAL_CRED_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

function saveLocalCredentials(data) {
  if (!fs.existsSync(LOCAL_CRED_DIR)) {
    fs.mkdirSync(LOCAL_CRED_DIR, { recursive: true });
  }
  fs.writeFileSync(LOCAL_CRED_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function clearLocalCredentials() {
  try {
    if (fs.existsSync(LOCAL_CRED_FILE)) {
      fs.unlinkSync(LOCAL_CRED_FILE);
    }
  } catch {}
}

async function verifyAuth(pool) {
  const creds = getLocalCredentials();
  const token = process.env.LAUJIM_SESSION_TOKEN || (creds && creds.token);
  const deviceId = process.env.LAUJIM_DEVICE_ID || (creds && creds.deviceId) || os.hostname().toLowerCase();

  if (!token) {
    return { ok: false, error: 'Sin credenciales. Ejecuta: node scripts/auth.cjs --temp o --permanent' };
  }

  const tokenHash = hashToken(token);
  const res = await pool.query(
    'SELECT * FROM authorized_devices WHERE device_id = $1 AND auth_token_hash = $2 AND is_active = TRUE',
    [deviceId, tokenHash]
  );

  if (res.rowCount === 0) {
    return { ok: false, error: 'Dispositivo no autorizado o revocado en Aiven.' };
  }

  const device = res.rows[0];
  if (device.expires_at && new Date(device.expires_at) < new Date()) {
    return { ok: false, error: 'Sesión temporal expirada. Inicia sesión nuevamente.' };
  }

  // Actualizar last_seen
  await pool.query('UPDATE authorized_devices SET last_seen_at = NOW() WHERE device_id = $1', [deviceId]);
  return { ok: true, device };
}

async function main() {
  const args = process.argv.slice(2);
  const pool = getPool();

  try {
    if (args.includes('--list')) {
      const res = await pool.query('SELECT device_id, device_name, session_type, is_active, expires_at, last_seen_at FROM authorized_devices ORDER BY created_at DESC');
      console.log('\n=== DISPOSITIVOS REGISTRADOS EN AIVEN ===');
      if (res.rows.length === 0) {
        console.log('No hay dispositivos autorizados.');
      } else {
        res.rows.forEach((r, idx) => {
          const status = !r.is_active ? '🔴 REVOCADO' : (r.expires_at && new Date(r.expires_at) < new Date()) ? '🟡 EXPIRADO' : '🟢 ACTIVO';
          console.log(`[${idx + 1}] ${r.device_name} (${r.device_id}) - ${r.session_type} - ${status}`);
          if (r.expires_at) console.log(`    Expira: ${new Date(r.expires_at).toLocaleString()}`);
          console.log(`    Visto por última vez: ${new Date(r.last_seen_at).toLocaleString()}`);
        });
      }
      return;
    }

    if (args.includes('--verify')) {
      const check = await verifyAuth(pool);
      if (check.ok) {
        console.log(`[+] Dispositivo autorizado: ${check.device.device_name} (${check.device.session_type})`);
      } else {
        console.log(`[-] ${check.error}`);
        process.exitCode = 1;
      }
      return;
    }

    if (args.includes('--logout')) {
      const creds = getLocalCredentials();
      if (creds && creds.deviceId) {
        await pool.query('UPDATE authorized_devices SET is_active = FALSE WHERE device_id = $1', [creds.deviceId]);
        console.log(`[+] Dispositivo ${creds.deviceId} revocado en Aiven.`);
      }
      clearLocalCredentials();
      console.log('[+] Credenciales locales eliminadas.');
      return;
    }

    if (args.includes('--revoke')) {
      const targetId = args[args.indexOf('--revoke') + 1];
      if (!targetId) {
        console.error('[-] Debes indicar el device_id a revocar. Ej: node scripts/auth.cjs --revoke pc-oficina');
        process.exitCode = 1;
        return;
      }
      const res = await pool.query('UPDATE authorized_devices SET is_active = FALSE WHERE device_id = $1 RETURNING *', [targetId]);
      if (res.rowCount > 0) {
        console.log(`[+] Dispositivo ${targetId} revocado exitosamente.`);
      } else {
        console.log(`[-] No se encontró el dispositivo ${targetId}.`);
      }
      return;
    }

    if (args.includes('--temp')) {
      const token = generateToken();
      const deviceId = 'temp_' + crypto.randomBytes(4).toString('hex');
      const deviceName = 'Sesión Temporal (' + (os.userInfo().username || 'usuario') + ')';
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 horas

      await pool.query(`
        INSERT INTO authorized_devices (device_id, device_name, auth_token_hash, session_type, expires_at, is_active)
        VALUES ($1, $2, $3, 'TEMPORARY', $4, TRUE)
      `, [deviceId, deviceName, hashToken(token), expiresAt]);

      console.log('\n================ SESIÓN TEMPORAL CREADA ================');
      console.log(`Dispositivo ID:  ${deviceId}`);
      console.log(`Token de Acceso: ${token}`);
      console.log(`Expira en:       2 horas (${expiresAt.toLocaleTimeString()})`);
      console.log('\nPuedes exportarlo en tu terminal o pasarle este token a la IA:');
      console.log(`$env:LAUJIM_SESSION_TOKEN="${token}"`);
      console.log(`$env:LAUJIM_DEVICE_ID="${deviceId}"`);
      console.log('========================================================\n');
      return;
    }

    if (args.includes('--permanent')) {
      const deviceId = (os.hostname() || 'laptop').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const deviceName = process.env.LAUJIM_DEVICE_NAME || `PC ${os.hostname()} (${os.platform()})`;
      const token = generateToken();

      await pool.query(`
        INSERT INTO authorized_devices (device_id, device_name, auth_token_hash, session_type, expires_at, is_active)
        VALUES ($1, $2, $3, 'PERMANENT', NULL, TRUE)
        ON CONFLICT (device_id) DO UPDATE SET
          auth_token_hash = EXCLUDED.auth_token_hash,
          is_active = TRUE,
          last_seen_at = NOW()
      `, [deviceId, deviceName, hashToken(token)]);

      saveLocalCredentials({ deviceId, deviceName, token, createdAt: new Date().toISOString() });

      console.log('\n================ PC AUTENTICADO DE FORMA PERMANENTE ================');
      console.log(`Dispositivo ID:    ${deviceId}`);
      console.log(`Nombre:            ${deviceName}`);
      console.log(`Credenciales en:   ${LOCAL_CRED_FILE}`);
      console.log('Este PC ya tiene acceso directo al Grafo y Memoria de Aiven.');
      console.log('====================================================================\n');
      return;
    }

    console.log(`
Uso de scripts/auth.cjs:
  node scripts/auth.cjs --permanent       Autoriza este PC de forma permanente
  node scripts/auth.cjs --temp            Genera un token efímero de 2 horas
  node scripts/auth.cjs --verify          Verifica el estado de autenticación actual
  node scripts/auth.cjs --list            Muestra todos los dispositivos autorizados
  node scripts/auth.cjs --revoke <id>     Revoca el acceso de un dispositivo en Aiven
  node scripts/auth.cjs --logout          Desconecta este equipo local
    `);

  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[-] Error en auth:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { verifyAuth, getLocalCredentials, hashToken, getPool };
