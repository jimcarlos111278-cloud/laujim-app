(function () {
  'use strict';

  function storeData(data) {
    chrome.storage.local.set({
      marketplaceData: data,
      timestamp: Date.now()
    });
  }

  function checkAndStore() {
    var el = document.getElementById('__LAUJIM_EXT_DATA__');
    if (!el) return;
    try {
      var data = JSON.parse(el.textContent);
      storeData(data);
      el.setAttribute('data-status', 'saved');
      setTimeout(function () { 
        var e = document.getElementById('__LAUJIM_EXT_DATA__');
        if (e) e.remove();
      }, 2000);
    } catch (e) {
      el.remove();
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
    checkAndStore();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(checkAndStore, 1000);

  checkAndStore();

  console.log('[Laujim Ext] Content script listo en Laujim');
})();
