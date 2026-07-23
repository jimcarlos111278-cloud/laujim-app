function isFacebookUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'facebook.com' || hostname.endsWith('.facebook.com');
  } catch {
    return false;
  }
}

function injectFacebookContent(tabId, url) {
  if (!tabId || !isFacebookUrl(url)) return;
  chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ['content-facebook.js'],
    injectImmediately: true
  }).catch((error) => {
    // Puede ocurrir durante una redirección; el siguiente cambio lo reintenta.
    console.debug('[Laujim] No se pudo inyectar aún:', error.message);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Laujim] Extensión instalada');
  // Las pestañas abiertas antes de instalar/recargar una extensión no reciben
  // los content scripts estáticos hasta refrescarse. Inyéctalo también aquí.
  chrome.tabs.query({ url: ['*://*.facebook.com/*'] }, (tabs) => {
    tabs.forEach((tab) => injectFacebookContent(tab.id, tab.url));
  });
});

// Respaldo para redirecciones entre www, m, web, etc. El script contiene una
// marca que evita duplicarlo cuando también lo inyectó el manifest.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if (isFacebookUrl(url) && (changeInfo.status === 'loading' || changeInfo.url)) {
    injectFacebookContent(tabId, url);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'REPORT_EXTENSION_ERROR') {
    chrome.storage.local.set({
      marketplaceLastError: {
        message: String(msg.message || 'Error desconocido'),
        context: String(msg.context || 'content-facebook'),
        timestamp: Date.now(),
        url: sender.tab?.url || ''
      }
    }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'GET_EXTENSION_ERROR') {
    chrome.storage.local.get('marketplaceLastError', (res) => {
      sendResponse(res.marketplaceLastError || null);
    });
    return true;
  }
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
    chrome.storage.local.remove(['marketplaceData', 'marketplaceLastError'], () => {
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
