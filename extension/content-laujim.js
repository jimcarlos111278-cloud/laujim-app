(function () {
  'use strict';

  function storeData(data) {
    var toStore = JSON.parse(JSON.stringify(data));
    if (toStore.photoUrls && Array.isArray(toStore.photoUrls)) {
      toStore.photoUrls = toStore.photoUrls.filter(function (u) { return u && u.indexOf('data:') !== 0; });
    }
    chrome.storage.local.set({
      marketplaceData: toStore,
      timestamp: Date.now()
    });
  }

  function checkAndStore() {
    var el = document.getElementById('__LAUJIM_EXT_DATA__');
    console.log('[Laujim] checkAndStore, element found:', !!el, 'body children:', document.body.children.length);
    if (!el) return;
    try {
      var text = el.textContent;
      console.log('[Laujim] text length:', text.length);
      var data = JSON.parse(text);
      console.log('[Laujim] parsed OK, keys:', Object.keys(data).join(','));
      storeData(data);
      el.setAttribute('data-status', 'saved');
      console.log('[Laujim] data-status set to saved');
      setTimeout(function () { 
        var e = document.getElementById('__LAUJIM_EXT_DATA__');
        if (e) e.remove();
      }, 2000);
    } catch (e) {
      console.log('[Laujim] error in checkAndStore:', e.message);
      el.remove();
    }
  }

  window.addEventListener('message', function (e) {
    console.log('[Laujim] postMessage received, type:', e.data?.type);
    if (e.data && e.data.type === 'LAUJIM_MARKETPLACE_DATA') {
      storeData(e.data.data);
      var el = document.getElementById('__LAUJIM_EXT_DATA__');
      if (el) {
        el.setAttribute('data-status', 'saved');
        console.log('[Laujim] data-status set from postMessage');
      }
    }
  });

  var observer = new MutationObserver(function (mutations) {
    console.log('[Laujim] Mutation observed:', mutations.length, 'mutations');
    checkAndStore();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[Laujim] Observer started');

  setInterval(function () {
    console.log('[Laujim] interval tick');
    checkAndStore();
  }, 1000);

  checkAndStore();

  console.log('[Laujim Ext] Content script listo en Laujim');
})();
