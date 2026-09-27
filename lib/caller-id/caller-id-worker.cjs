const {
  createClaimNextJob,
  saveLookupResult,
  markJob,
  rescheduleJob
} = require('./caller-id-repository.cjs');

function startCallerIdWorker({ db, provider, logger = console }) {
  const runtime = {
    pausedForAuth: false,
    lastSuccessAt: null,
    lastErrorCode: null
  };

  const isEnabled = process.env.TRUECALLER_ENABLED === 'true';
  if (!isEnabled) {
    logger.info('[CallerIdWorker] Worker disabled (TRUECALLER_ENABLED != true)');
    return {
      stop() {},
      getState: () => ({ ...runtime, enabled: false })
    };
  }

  // Recuperar trabajo interrumpido por reinicio
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE caller_lookup_jobs
    SET status = 'queued', next_attempt_at = NULL, updated_at = ?
    WHERE status IN ('running', 'auth_required')
  `).run(now);

  const minimumInterval = Math.max(
    Number(process.env.TRUECALLER_MIN_INTERVAL_MS || 5000),
    5000
  );

  const claimNextJob = createClaimNextJob(db);
  let busy = false;

  async function tick() {
    if (busy || runtime.pausedForAuth) return;
    const job = claimNextJob();
    if (!job) return;

    busy = true;
    try {
      logger.info(`[CallerIdWorker] Looking up ${job.phone_e164} (Job #${job.id})...`);
      const result = await provider.lookup(job.phone_e164);
      saveLookupResult(db, job, result);
      runtime.lastSuccessAt = new Date().toISOString();
      runtime.lastErrorCode = null;
      logger.info(`[CallerIdWorker] Job #${job.id} completed: ${result.status} (${result.possibleName || 'No name'})`);
    } catch (error) {
      runtime.lastErrorCode = error.code || 'PROVIDER_FAILED';
      logger.error(`[CallerIdWorker] Job #${job.id} failed with ${runtime.lastErrorCode}: ${error.message}`);

      if (error.code === 'AUTH_REQUIRED') {
        runtime.pausedForAuth = true;
        markJob(db, job.id, 'auth_required', error);
      } else if (error.code === 'RATE_LIMITED') {
        rescheduleJob(db, job.id, 'rate_limited', error, 6 * 60 * 60 * 1000);
      } else if (job.attempts >= Number(process.env.TRUECALLER_MAX_ATTEMPTS || 3)) {
        markJob(db, job.id, 'failed', error);
      } else {
        const delay = Math.min(60 * 60 * 1000, 30000 * (2 ** job.attempts));
        rescheduleJob(db, job.id, 'queued', error, delay);
      }
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void tick(), minimumInterval);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  void tick();

  return {
    stop: () => clearInterval(timer),
    getState: () => ({ ...runtime, enabled: true })
  };
}

module.exports = { startCallerIdWorker };
