chrome.runtime.onInstalled.addListener(() => {
  console.log('[Laujim] Extensión instalada');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LAUJIM_MARKETPLACE_DATA') {
    chrome.storage.local.set({ marketplaceData: msg.data, timestamp: Date.now() }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === 'GET_MARKETPLACE_DATA') {
    chrome.storage.local.get('marketplaceData', (res) => {
      sendResponse(res.marketplaceData || null);
    });
    return true;
  }
  if (msg.type === 'CLEAR_MARKETPLACE_DATA') {
    chrome.storage.local.remove('marketplaceData', () => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === 'GET_SAVED_URLS') {
    chrome.storage.local.get('savedUrls', (res) => {
      sendResponse(res.savedUrls || []);
    });
    return true;
  }
  if (msg.type === 'SAVE_URL') {
    chrome.storage.local.get('savedUrls', (res) => {
      const urls = res.savedUrls || [];
      const existing = urls.findIndex(u => u.aptId === msg.aptId);
      if (existing >= 0) {
        urls[existing] = { aptId: msg.aptId, aptName: msg.aptName, url: msg.url, date: Date.now() };
      } else {
        urls.push({ aptId: msg.aptId, aptName: msg.aptName, url: msg.url, date: Date.now() });
      }
      chrome.storage.local.set({ savedUrls: urls }, () => sendResponse({ ok: true }));
    });
    return true;
  }
  if (msg.type === 'REMOVE_URL') {
    chrome.storage.local.get('savedUrls', (res) => {
      const urls = (res.savedUrls || []).filter(u => u.aptId !== msg.aptId);
      chrome.storage.local.set({ savedUrls: urls }, () => sendResponse({ ok: true }));
    });
    return true;
  }
});
