'use strict';
const jobId = String(process.argv[2] || '39');
const SERVER = 'http://127.0.0.1:10000';
const TOKEN = process.env.FB_VM_WORKER_TOKEN || process.env.SCRAPER_WORKER_TOKEN || '2bff765bfd0b4269674044f59c5282c6812adb17b4586fce857b5ba942baf191';
const DEVICE = 'vm-facebook';

(async () => {
  console.log(`Poniendo job ${jobId} en needs_review...`);
  const r1 = await fetch(`${SERVER}/worker/v1/marketplace/jobs/${jobId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': TOKEN, 'X-Worker-Id': DEVICE },
    body: JSON.stringify({ deviceId: DEVICE, status: 'needs_review' })
  });
  console.log('Status result:', r1.status);

  console.log(`Reintentando job ${jobId}...`);
  const r2 = await fetch(`${SERVER}/worker/v1/marketplace/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': TOKEN, 'X-Worker-Id': DEVICE },
    body: JSON.stringify({ deviceId: DEVICE })
  });
  const data = await r2.json().catch(() => ({}));
  console.log('Retry result:', r2.status, JSON.stringify(data));
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
