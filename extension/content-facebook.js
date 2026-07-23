(function () {
  'use strict';

  var ATTEMPTS = 0;
  var MAX_ATTEMPTS = 60;
  var POLL_MS = 1500;

  function log(msg) {
    console.log('[Laujim] ' + msg);
  }

  log('Content script loaded, path: ' + window.location.pathname);

  function setNativeValue(el, val) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (el.isContentEditable) {
      el.textContent = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    var proto = Object.getOwnPropertyDescriptor(
      tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value'
    );
    if (proto && proto.set) {
      proto.set.call(el, val);
    } else {
      el.value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getAllEditable() {
    return document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), ' +
      'textarea, select, div[contenteditable="true"], div[role="textbox"], ' +
      'div[data-lexical-editor="true"], div[contenteditable="plaintext-only"]'
    );
  }

  function textNear(el) {
    var t = '';
    var p = el.parentElement;
    for (var i = 0; i < 5 && p; i++) {
      t = (p.textContent || '') + ' ' + t;
      p = p.parentElement;
    }
    var prev = el.previousElementSibling;
    if (prev) t = (prev.textContent || '') + ' ' + t;
    var label = el.closest('label');
    if (label) t = (label.textContent || '') + ' ' + t;
    t += ' ' + (el.getAttribute('aria-label') || '');
    t += ' ' + (el.getAttribute('placeholder') || '');
    t += ' ' + (el.getAttribute('name') || '');
    return t.toLowerCase();
  }

  function matchKeywords(el, keywords) {
    var t = textNear(el);
    for (var k = 0; k < keywords.length; k++) {
      if (t.indexOf(keywords[k]) >= 0) return true;
    }
    return false;
  }

  function findAndSet(fields) {
    var result = [];
    var all = getAllEditable();
    log('Found ' + all.length + ' editable elements');

    for (var f = 0; f < fields.length; f++) {
      if (!fields[f].val && fields[f].val !== 0) continue;
      var found = false;
      for (var a = 0; a < all.length; a++) {
        if (all[a].value && all[a].value.length > 0) continue;
        if (matchKeywords(all[a], fields[f].kw)) {
          try {
            setNativeValue(all[a], fields[f].val);
            result.push(fields[f].name);
            found = true;
            break;
          } catch (e) {
            log('Error setting ' + fields[f].name + ': ' + e.message);
          }
        }
      }
      if (!found) {
        for (var a2 = 0; a2 < all.length; a2++) {
          if (matchKeywords(all[a2], fields[f].kw)) {
            try {
              setNativeValue(all[a2], fields[f].val);
              result.push(fields[f].name + '(filled)');
              found = true;
              break;
            } catch (e) {}
          }
        }
      }
      if (!found) log('Could not find field: ' + fields[f].name + ' (' + fields[f].kw.join(',') + ')');
    }
    return result;
  }

  async function uploadPhotos(photoUrls) {
    if (!photoUrls || photoUrls.length === 0 || photoUrls[0] === '') return 0;
    var uploaded = 0;
    for (var i = 0; i < photoUrls.length; i++) {
      var url = photoUrls[i];
      if (!url || url.indexOf('data:') === 0) continue;
      try {
        var res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var blob = await res.blob();
        var ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        var file = new File([blob], 'foto_' + (i + 1) + '.' + ext, { type: blob.type });

        var inputs = document.querySelectorAll('input[type="file"]');
        var input = null;
        for (var ii = 0; ii < inputs.length; ii++) {
          if ((inputs[ii].getAttribute('accept') || '').indexOf('image') >= 0) { input = inputs[ii]; break; }
        }
        if (!input) input = inputs[0];

        if (input) {
          var dt = new DataTransfer();
          dt.items.add(file);
          Object.defineProperty(input, 'files', { value: dt.files, configurable: true, writable: false });
          input.dispatchEvent(new Event('change', { bubbles: true }));
          uploaded++;
          log('Photo ' + (i + 1) + ' uploaded via file input');
          await new Promise(function (r) { setTimeout(r, 500); });
        } else {
          log('No file input found for photo ' + (i + 1));
        }
      } catch (e) {
        log('Photo ' + (i + 1) + ' failed: ' + e.message);
      }
    }
    return uploaded;
  }

  async function autoFill() {
    log('autoFill() called');

    var data = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'GET_MARKETPLACE_DATA' }, resolve);
    });
    log('Data from storage: ' + (data ? 'YES' : 'NO'));
    if (!data || !data.title) {
      log('No data available, stopping');
      return;
    }
    log('Data: title="' + data.title + '" price="' + data.price + '" photos=' + (data.photoUrls ? data.photoUrls.length : 0));

    var fields = [
      { name: 'title', kw: ['título', 'title', 'titulo', 'nombre del anuncio', 'listing title'], val: data.title },
      { name: 'price', kw: ['precio', 'price', 'valor', 'amount'], val: data.price },
      { name: 'description', kw: ['descripción', 'description', 'descripcion', 'detalles', 'details'], val: data.description },
      { name: 'bedrooms', kw: ['habitaciones', 'bedroom', 'bedrooms', 'cuartos', 'dormitorios'], val: data.bedrooms },
      { name: 'bathrooms', kw: ['baños', 'bath', 'bathrooms', 'banos', 'baño', 'bano'], val: data.bathrooms },
      { name: 'area', kw: ['metros', 'square', 'área', 'area', 'tamaño', 'size', 'superficie', 'sq. ft', 'm²'], val: data.area },
    ];

    var filled = findAndSet(fields);
    log('Filled fields: ' + (filled.length ? filled.join(', ') : 'NONE'));

    var photoCount = 0;
    if (data.photoUrls && data.photoUrls.length > 0) {
      photoCount = await uploadPhotos(data.photoUrls);
      log('Uploaded photos: ' + photoCount);
    }

    if (filled.length > 0 || photoCount > 0) {
      var parts = [];
      if (filled.length > 0) parts.push('Campos: ' + filled.length);
      if (photoCount > 0) parts.push('Fotos: ' + photoCount);
      var msg = document.createElement('div');
      msg.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:#059669;color:white;padding:16px 20px;border-radius:12px;font-family:sans-serif;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:360px;line-height:1.5;';
      msg.textContent = '✓ Laujim: ' + parts.join(' · ');
      document.body.appendChild(msg);
      setTimeout(function () { msg.remove(); }, 6000);
      log('Notification shown');
    } else {
      log('NOTHING was filled');
    }

    chrome.runtime.sendMessage({ type: 'CLEAR_MARKETPLACE_DATA' });
  }

  function checkAndRun() {
    var path = window.location.pathname.toLowerCase();
    var isMP = path.indexOf('/marketplace/') >= 0;
    log('checkAndRun #' + ATTEMPTS + ' path=' + path + ' isMarketplace=' + isMP);

    if (!isMP) return;

    var inputs = document.querySelectorAll('input, textarea, select');
    log('Inputs on page: ' + inputs.length);
    if (inputs.length === 0) {
      ATTEMPTS++;
      if (ATTEMPTS < MAX_ATTEMPTS) setTimeout(checkAndRun, POLL_MS);
      return;
    }

    chrome.runtime.sendMessage({ type: 'GET_MARKETPLACE_DATA' }, function (data) {
      log('Data check: ' + (data ? 'found' : 'null'));
      if (data && data.title) {
        log('Data found! Starting auto-fill');
        setTimeout(autoFill, 800);
      } else {
        ATTEMPTS++;
        if (ATTEMPTS < MAX_ATTEMPTS) setTimeout(checkAndRun, POLL_MS);
      }
    });
  }

  var initialPath = window.location.pathname.toLowerCase();
  if (initialPath.indexOf('/marketplace/') >= 0) {
    log('On marketplace page, starting checks');
    setTimeout(checkAndRun, 2000);
  } else {
    log('Not on marketplace page, waiting for navigation');
  }

  var lastUrl = window.location.href;
  setInterval(function () {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      log('URL changed to: ' + window.location.pathname);
      if (window.location.pathname.toLowerCase().indexOf('/marketplace/') >= 0) {
        ATTEMPTS = 0;
        setTimeout(checkAndRun, 1500);
      }
    }
  }, 500);

  window.addEventListener('popstate', function () {
    log('popstate: ' + window.location.pathname);
    if (window.location.pathname.toLowerCase().indexOf('/marketplace/') >= 0) {
      ATTEMPTS = 0;
      setTimeout(checkAndRun, 1500);
    }
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'TRIGGER_AUTOFILL') {
      ATTEMPTS = 0;
      autoFill().then(function () { sendResponse({ ok: true }); });
      return true;
    }
    if (msg.type === 'DELETE_LISTING') {
      if (msg.url) window.location.href = msg.url;
      sendResponse({ ok: true });
    }
  });

  log('Content script initialization complete');
})();
