(function () {
  'use strict';

  let lastData = null;

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'LAUJIM_MARKETPLACE_DATA') {
      lastData = e.data.data;
      chrome.storage.local.set({
        marketplaceData: e.data.data,
        timestamp: Date.now()
      }, function () {
        console.log('[Laujim Ext] Datos de Marketplace guardados');
      });
    }
  });

  window.addEventListener('laujim-marketplace-save-url', function (e) {
    if (e.detail) {
      chrome.runtime.sendMessage({
        type: 'SAVE_URL',
        aptId: e.detail.aptId,
        aptName: e.detail.aptName,
        url: e.detail.url
      });
    }
  });

  window.addEventListener('laujim-marketplace-remove-url', function (e) {
    if (e.detail && e.detail.aptId) {
      chrome.runtime.sendMessage({ type: 'REMOVE_URL', aptId: e.detail.aptId });
    }
  });

  console.log('[Laujim Ext] Content script listo en Laujim');
})();
