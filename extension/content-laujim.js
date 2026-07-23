(function () {
  'use strict';

  function storeData(data) {
    chrome.storage.local.set({
      marketplaceData: data,
      timestamp: Date.now()
    });
  }

  function tryStoreFromDOM() {
    var el = document.getElementById('__LAUJIM_EXT_DATA__');
    if (!el) return false;
    try {
      var data = JSON.parse(el.textContent);
      storeData(data);
      el.setAttribute('data-status', 'saved');
      setTimeout(function () { el.remove(); }, 2000);
      return true;
    } catch (e) {
      el.remove();
      return false;
    }
  }

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'LAUJIM_MARKETPLACE_DATA') {
      storeData(e.data.data);
      var el = document.getElementById('__LAUJIM_EXT_DATA__');
      if (el) el.setAttribute('data-status', 'saved');
    }
  });

  var observer = new MutationObserver(function () {
    if (tryStoreFromDOM()) {
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  tryStoreFromDOM();
  setTimeout(function () { observer.disconnect(); }, 10000);

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
