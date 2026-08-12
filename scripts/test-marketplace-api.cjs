const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const project = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'laujim-marketplace-api-'));
const port = 11024;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.cjs'], {
  cwd: project,
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe'],
  env: {
    ...process.env,
    PORT: String(port),
    PERSISTENT_DIR: tempRoot,
    AIVEN_DATABASE_URL: '',
    DATABASE_URL: '',
    ADMIN_USERNAME: 'marketplace-test-admin',
    ADMIN_PASSWORD: 'marketplace-test-password',
    SCRAPER_WORKER_ENABLED: 'true',
    SCRAPER_WORKER_TOKEN: 'marketplace-test-worker-token',
  },
});

let stderr = '';
child.stderr.on('data', chunk => { stderr += String(chunk); });

async function request(route, options = {}) {
  const response = await fetch(base + route, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route}: HTTP ${response.status} ${payload.error || ''}`.trim());
  return payload;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(base + '/health');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Test server did not start. ${stderr}`.trim());
}

async function run() {
  await waitForServer();
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'marketplace-test-admin', password: 'marketplace-test-password' }),
  });
  const adminHeaders = { 'content-type': 'application/json', 'x-auth-token': login.token };
  const apartment = await request('/api/apartments', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({
      name: 'TEST-101', status: 'vacant', monthlyRent: 1_000_000,
      rooms: 2, bathrooms: 1, area: 55,
      marketplaceAddress: 'Barranquilla, Atlantico',
    }),
  });
  await request('/api/photos', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ apartmentId: apartment.id, data: 'data:image/jpeg;base64,AA==' }),
  });
  const queued = await request('/api/marketplace/jobs', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ apartmentId: apartment.id, publish: true }),
  });
  const workerHeaders = {
    'content-type': 'application/json',
    'x-worker-token': 'marketplace-test-worker-token',
    'x-worker-id': 'android-test',
  };
  const claimed = await request('/worker/v1/marketplace/jobs/next', { headers: workerHeaders });
  const completed = await request(`/worker/v1/marketplace/jobs/${claimed.job.id}/status`, {
    method: 'POST', headers: workerHeaders,
    body: JSON.stringify({ status: 'needs_review', message: 'dry run' }),
  });
  if (queued.job.status !== 'queued' || completed.job.status !== 'needs_review' || completed.job.photoCount !== 1) {
    throw new Error('Marketplace queue state transition failed.');
  }
  if ('password' in claimed.job || 'cookies' in claimed.job || 'token' in claimed.job) {
    throw new Error('A secret field leaked into the worker job.');
  }
  console.log(JSON.stringify({
    queued: queued.job.status,
    claimed: claimed.job.id,
    final: completed.job.status,
    photos: completed.job.photoCount,
    secretFields: false,
  }));
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  child.kill();
  const resolved = path.resolve(tempRoot);
  const temp = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(temp)) fs.rmSync(resolved, { recursive: true, force: true });
});
