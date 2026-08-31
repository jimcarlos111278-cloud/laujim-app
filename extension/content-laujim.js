(function () {
  'use strict';

  // Record the authenticated session so background.js can fetch the portal
  // credentials (Air-e login) and have the content script autofill them.
  function sessionFromPage() {
    var base = '';
    var custom = localStorage.getItem('apt_server_url');
    if (custom) {
      base = custom + '/api';
    } else {
      base = window.location.origin + '/api';
    }
    var token = '';
    try {
      token = JSON.parse(localStorage.getItem('apt_auth') || '{}').token || '';
    } catch (e) { token = ''; }
    return { apiBase: base, token: token };
  }

  // Stash the live session for the background worker. Keeps the token out of
  // the bundle and lets GET_PORTAL_CREDENTIALS reuse the user's login.
  function storeSession() {
    var s = sessionFromPage();
    if (s.apiBase && s.token) {
      chrome.storage.local.set({ laujimSession: s });
    }
  }

  function storeData(data) {
    chrome.storage.local.set({
      marketplaceData: data,
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

  storeSession();
  setInterval(storeSession, 60000);

  console.log('[Laujim Ext] Content script listo en Laujim');
})();
