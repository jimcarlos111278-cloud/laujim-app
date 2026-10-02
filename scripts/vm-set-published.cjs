'use strict';
const TOKEN = process.env.FB_VM_WORKER_TOKEN || process.env.SCRAPER_WORKER_TOKEN || '2bff765bfd0b4269674044f59c5282c6812adb17b4586fce857b5ba942baf191';
const DEVICE = 'vm-facebook';
const SERVER = 'http://127.0.0.1:10000';

(async () => {
  const r = await fetch(`${SERVER}/worker/v1/marketplace/jobs/39/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': TOKEN, 'X-Worker-Id': DEVICE },
    body: JSON.stringify({
      deviceId: DEVICE,
      status: 'published',
      message: 'Publicado exitosamente en Facebook Marketplace desde la VM.',
      listingUrl: 'https://www.facebook.com/marketplace/item/1466241258759952/'
    })
  });
  console.log('STATUS:', r.status);
  const data = await r.json().catch(() => ({}));
  console.log('RESPONSE:', JSON.stringify(data));
})().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
