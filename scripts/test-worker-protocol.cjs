'use strict';

const assert = require('node:assert/strict');
const worker = require('../worker-protocol.cjs');

assert.equal(worker.normalizeWorkerId('android-laujim-01'), 'android-laujim-01');
assert.equal(worker.normalizeWorkerId('bad id'), null);
assert.equal(worker.normalizeAmount('$ 103.230'), 103230);
assert.equal(worker.normalizeAmount(null), null);
assert.equal(worker.safeTokenEquals('secret-token', 'secret-token'), true);
assert.equal(worker.safeTokenEquals('secret-token', 'other-token'), false);

const records = worker.normalizeWorkerResults({ results: [
  {
    provider: 'Triple A', service: 'water', apartment: '403',
    status: 'pending', deudaMesCOP: '$ 2.000', deudaConveniosCOP: '$ 3.000',
    cuotaFinanciadaCOP: '$ 125', deudaTotalCOP: '$ 5.000', waterPaymentCode: '66499604',
    ignoredSecret: 'must-not-survive',
  },
  {
    provider: 'Air-e', service: 'electricity', apartmentId: 4,
    status: 'paid', deudaTotalCOP: 0, nic: '7889039',
  },
] }, { deviceId: 'android-laujim-01' });

assert.equal(records.length, 2);
assert.equal(records[0].deudaTotalCOP, 5000);
assert.equal(records[0].deudaMesCOP, 2000);
assert.equal(records[0].deudaConveniosCOP, 3000);
assert.equal(records[0].financiadaCOP, 3000);
assert.equal(records[0].cuotaFinanciadaCOP, 125);
assert.equal(records[0].deudaLabel, 'Deuda Total');
assert.equal(records[0].source, 'portable-worker');
assert.equal(records[0].workerDeviceId, 'android-laujim-01');
assert.equal(records[0].ignoredSecret, undefined);
assert.equal(records[1].provider, 'Air-e');
assert.equal(records[1].status, 'paid');

console.log('Portable worker protocol checks passed.');
