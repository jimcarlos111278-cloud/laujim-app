const { Pool } = require('pg');

const AIVEN_URL = process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL;

async function setupTables() {
  if (!AIVEN_URL) {
    console.error('[-] Error: AIVEN_DATABASE_URL no está configurada.');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: AIVEN_URL.replace(/sslmode=[^&]+&?/, ''),
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('[+] Conectando a Aiven...');
    await pool.query('SELECT 1');
    console.log('[+] Conexión establecida.');

    // 1. Tabla de Dispositivos y Sesiones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS authorized_devices (
        device_id VARCHAR(100) PRIMARY KEY,
        device_name VARCHAR(100) NOT NULL,
        auth_token_hash VARCHAR(255) NOT NULL,
        session_type VARCHAR(20) NOT NULL,
        expires_at TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[+] Tabla authorized_devices verificada/creada.');

    // 2. Tabla de Memoria Viva y Decisiones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id SERIAL PRIMARY KEY,
        source VARCHAR(50),
        author VARCHAR(100),
        action_type VARCHAR(50),
        description TEXT,
        files_changed JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[+] Tabla agent_memory verificada/creada.');

    // Verificar si ya existe al menos el dispositivo principal de la VM y admin
    const devices = await pool.query('SELECT * FROM authorized_devices');
    console.log(`[+] Dispositivos autorizados actualmente: ${devices.rowCount}`);

  } catch (err) {
    console.error('[-] Error configurando Aiven:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

setupTables();
