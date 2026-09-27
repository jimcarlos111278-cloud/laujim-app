const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function initDatabase(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, '..', '..', 'data', 'caller_reputation.sqlite');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Migración transaccional inicial
  db.exec(`
    CREATE TABLE IF NOT EXISTS caller_lookup_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT,
        phone_e164 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
            status IN (
                'queued', 'running', 'found', 'not_found',
                'auth_required', 'rate_limited', 'failed'
            )
        ),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS caller_lookup_jobs_one_active_phone
    ON caller_lookup_jobs(phone_e164)
    WHERE status IN ('queued', 'running', 'rate_limited');

    CREATE INDEX IF NOT EXISTS caller_lookup_jobs_next
    ON caller_lookup_jobs(status, next_attempt_at, created_at);

    CREATE TABLE IF NOT EXISTS caller_reputation_cache (
        phone_e164 TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        lookup_status TEXT NOT NULL CHECK (lookup_status IN ('found', 'not_found')),
        possible_name TEXT,
        alternate_name TEXT,
        category TEXT,
        spam_score REAL,
        report_count INTEGER,
        location TEXT,
        line_type TEXT,
        avatar_url TEXT,
        email TEXT,
        raw_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gate_unlock_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        user_id TEXT,
        device_id TEXT,
        call_id TEXT,
        source TEXT NOT NULL,
        outcome TEXT NOT NULL,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
    );
  `);

  return db;
}

function enqueueLookup(db, eventId, phoneE164) {
  const now = new Date().toISOString();
  const cached = db.prepare(`
    SELECT phone_e164, lookup_status, expires_at
    FROM caller_reputation_cache
    WHERE phone_e164 = ? AND expires_at > ?
  `).get(phoneE164, now);

  if (cached) return { status: cached.lookup_status, cached: true };

  db.prepare(`
    INSERT OR IGNORE INTO caller_lookup_jobs (
      event_id, phone_e164, status, attempts, created_at, updated_at
    ) VALUES (?, ?, 'queued', 0, ?, ?)
  `).run(eventId || null, phoneE164, now, now);

  const job = db.prepare(`
    SELECT id, phone_e164, status
    FROM caller_lookup_jobs
    WHERE phone_e164 = ? AND status IN ('queued', 'running', 'rate_limited')
    ORDER BY id DESC LIMIT 1
  `).get(phoneE164);

  return job || { status: 'queued', cached: false };
}

function createClaimNextJob(db) {
  return db.transaction(() => {
    const now = new Date().toISOString();
    const job = db.prepare(`
      SELECT * FROM caller_lookup_jobs
      WHERE status IN ('queued', 'rate_limited')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC
      LIMIT 1
    `).get(now);

    if (!job) return null;

    const result = db.prepare(`
      UPDATE caller_lookup_jobs
      SET status = 'running', attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'rate_limited')
    `).run(now, job.id);

    return result.changes === 1
      ? db.prepare('SELECT * FROM caller_lookup_jobs WHERE id = ?').get(job.id)
      : null;
  });
}

function saveLookupResult(db, job, result) {
  if (!['found', 'not_found'].includes(result.status)) {
    throw new Error(`Unsupported lookup status: ${result.status}`);
  }

  const now = new Date().toISOString();
  const ttlDays = result.status === 'found'
    ? Number(process.env.TRUECALLER_CACHE_DAYS || 45)
    : Number(process.env.TRUECALLER_NOT_FOUND_CACHE_DAYS || 7);

  const expiresAt = new Date(
    Date.now() + Math.max(ttlDays, 1) * 86400000
  ).toISOString();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO caller_reputation_cache (
        phone_e164, provider, lookup_status, possible_name, alternate_name,
        category, spam_score, report_count, location, line_type,
        avatar_url, email, raw_json, fetched_at, expires_at
      ) VALUES (
        @phone, 'truecaller-unofficial', @status, @possibleName, @alternateName,
        @category, @spamScore, @reportCount, @location, @lineType,
        @avatarUrl, @email, @rawJson, @now, @expiresAt
      )
      ON CONFLICT(phone_e164) DO UPDATE SET
        provider = excluded.provider,
        lookup_status = excluded.lookup_status,
        possible_name = excluded.possible_name,
        alternate_name = excluded.alternate_name,
        category = excluded.category,
        spam_score = excluded.spam_score,
        report_count = excluded.report_count,
        location = excluded.location,
        line_type = excluded.line_type,
        avatar_url = excluded.avatar_url,
        email = excluded.email,
        raw_json = excluded.raw_json,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `).run({
      phone: job.phone_e164,
      status: result.status,
      possibleName: result.possibleName ?? null,
      alternateName: result.alternateName ?? null,
      category: result.category ?? null,
      spamScore: result.spamScore ?? null,
      reportCount: result.reportCount ?? null,
      location: result.location ?? null,
      lineType: result.lineType ?? null,
      avatarUrl: result.avatarUrl ?? null,
      email: result.email ?? null,
      rawJson: JSON.stringify(result.raw ?? {}),
      now,
      expiresAt
    });

    db.prepare(`
      UPDATE caller_lookup_jobs
      SET status = ?, next_attempt_at = NULL,
          last_error_code = NULL, last_error_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(result.status, now, job.id);
  })();
}

function markJob(db, jobId, status, error) {
  const message = String(error?.message || 'Provider error').slice(0, 500);
  db.prepare(`
    UPDATE caller_lookup_jobs
    SET status = ?, next_attempt_at = NULL,
        last_error_code = ?, last_error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(status, error?.code || 'PROVIDER_FAILED', message, new Date().toISOString(), jobId);
}

function rescheduleJob(db, jobId, status, error, delayMs) {
  const now = new Date();
  const next = new Date(now.getTime() + delayMs).toISOString();
  const message = String(error?.message || 'Provider error').slice(0, 500);
  db.prepare(`
    UPDATE caller_lookup_jobs
    SET status = ?, next_attempt_at = ?,
        last_error_code = ?, last_error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(status, next, error?.code || 'PROVIDER_FAILED', message, now.toISOString(), jobId);
}

function getCallerCache(db, phoneE164) {
  return db.prepare(`
    SELECT * FROM caller_reputation_cache
    WHERE phone_e164 = ? AND expires_at > ?
  `).get(phoneE164, new Date().toISOString()) || null;
}

function getLatestJob(db, phoneE164) {
  return db.prepare(`
    SELECT * FROM caller_lookup_jobs
    WHERE phone_e164 = ?
    ORDER BY id DESC LIMIT 1
  `).get(phoneE164) || null;
}

module.exports = {
  initDatabase,
  enqueueLookup,
  createClaimNextJob,
  saveLookupResult,
  markJob,
  rescheduleJob,
  getCallerCache,
  getLatestJob
};
