(function () {
  'use strict';

  var RETRY_INTERVAL = 1200;
  var MAX_WAIT_MS = 45000;

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
      tag === 'input' ? HTMLInputElement.prototype :
      tag === 'textarea' ? HTMLTextAreaElement.prototype :
      null, 'value'
    );
    if (proto && proto.set) {
      proto.set.call(el, val);
    } else {
      el.value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findAllInputs() {
    return document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), ' +
      'textarea, select, div[contenteditable="true"]'
    );
  }

  function matchesLabel(el, keywords) {
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    var ph = (el.getAttribute('placeholder') || '').toLowerCase();
    var name = (el.getAttribute('name') || '').toLowerCase();
    var testId = (el.getAttribute('data-testid') || '').toLowerCase();
    var label = '';
    var lbl = el.closest('label');
    if (lbl) label = lbl.textContent.toLowerCase();
    var parentEl = el.parentElement;
    if (parentEl) {
      var grandParent = parentEl.parentElement;
      if (grandParent) label += ' ' + grandParent.textContent.toLowerCase();
    }
    var allText = aria + ' ' + ph + ' ' + name + ' ' + testId + ' ' + label;
    for (var k = 0; k < keywords.length; k++) {
      if (allText.indexOf(keywords[k]) >= 0) return true;
    }
    return false;
  }

  function setFieldByLabel(keywords, val) {
    if (val === undefined || val === null || val === '') return false;
    var inputs = findAllInputs();
    for (var i = 0; i < inputs.length; i++) {
      if (matchesLabel(inputs[i], keywords) && !inputs[i].value) {
        try {
          setNativeValue(inputs[i], val);
          return true;
        } catch (e) {
          console.warn('[Laujim] setField failed:', keywords[0], e);
        }
      }
    }
    for (var j = 0; j < inputs.length; j++) {
      if (matchesLabel(inputs[j], keywords)) {
        try {
          setNativeValue(inputs[j], val);
          return true;
        } catch (e) {}
      }
    }
    return false;
  }

  function findPhotoUploadTarget() {
    var selectors = [
      'input[type="file"]',
      'form input[type="file"]',
      'div[role="button"] input[type="file"]',
    ];
    for (var s = 0; s < selectors.length; s++) {
      var el = document.querySelector(selectors[s]);
      if (el) return el;
    }
    return null;
  }

  function clickPhotoButton() {
    var labels = ['add photo', 'add photos', 'agregar foto', 'añadir foto', 'subir foto', 'upload'];
    var all = document.querySelectorAll('div[role="button"], span[role="button"], button, a');
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || '').toLowerCase();
      var aria = (all[i].getAttribute('aria-label') || '').toLowerCase();
      for (var l = 0; l < labels.length; l++) {
        if (t.indexOf(labels[l]) >= 0 || aria.indexOf(labels[l]) >= 0) {
          all[i].click();
          return true;
        }
      }
    }
    return false;
  }

  async function uploadOnePhoto(url, idx) {
    try {
      var res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var blob = await res.blob();
      var ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      var file = new File([blob], 'foto_' + idx + '.' + ext, { type: blob.type });

      var input = findPhotoUploadTarget();
      if (input) {
        var dt = new DataTransfer();
        dt.items.add(file);
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true, writable: false });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(function (r) { setTimeout(r, 600); });
        return true;
      }

      if (clickPhotoButton()) {
        await new Promise(function (r) { setTimeout(r, 2000); });
        var input2 = findPhotoUploadTarget();
        if (input2) {
          var dt2 = new DataTransfer();
          dt2.items.add(file);
          Object.defineProperty(input2, 'files', { value: dt2.files, configurable: true, writable: false });
          input2.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(function (r) { setTimeout(r, 600); });
          return true;
        }
      }

      return false;
    } catch (e) {
      console.warn('[Laujim] Photo', idx, 'failed:', e.message);
      return false;
    }
  }

  async function fillForm(data) {
    var fields = [
      { kw: ['título', 'title', 'titulo'], val: data.title },
      { kw: ['precio', 'price'], val: data.price },
      { kw: ['descripción', 'description', 'descripcion'], val: data.description },
      { kw: ['habitaciones', 'bedroom', 'cuartos', 'rooms'], val: data.bedrooms },
      { kw: ['baños', 'bath', 'banos', 'bathroom'], val: data.bathrooms },
      { kw: ['metros', 'square', 'área', 'area', 'tamaño', 'size', 'superficie', 'sq. ft'], val: data.area },
    ];

    var filled = [];
    for (var f = 0; f < fields.length; f++) {
      for (var t = 0; t < 3; t++) {
        if (setFieldByLabel(fields[f].kw, fields[f].val)) {
          filled.push(fields[f].kw[0]);
          break;
        }
        await new Promise(function (r) { setTimeout(r, 500); });
      }
    }
    return filled;
  }

  async function autoFill() {
    var data = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'GET_MARKETPLACE_DATA' }, resolve);
    });
    if (!data || !data.title) return;

    var filled = await fillForm(data);

    var photoCount = 0;
    if (data.photoUrls && data.photoUrls.length > 0 && data.photoUrls[0]) {
      for (var i = 0; i < data.photoUrls.length; i++) {
        if (await uploadOnePhoto(data.photoUrls[i], i + 1)) photoCount++;
      }
    }

    if (filled.length > 0 || photoCount > 0) {
      var parts = [];
      if (filled.length > 0) parts.push('Campos: ' + filled.length);
      if (photoCount > 0) parts.push('Fotos: ' + photoCount);
      var msg = document.createElement('div');
      msg.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;background:#059669;color:white;padding:16px 20px;border-radius:12px;font-family:sans-serif;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:360px;line-height:1.5;z-index:2147483647';
      msg.textContent = '✓ Laujim: ' + parts.join(' · ');
      document.body.appendChild(msg);
      setTimeout(function () { msg.remove(); }, 6000);
    }

    chrome.runtime.sendMessage({ type: 'CLEAR_MARKETPLACE_DATA' });
  }

  var started = false;
  var startTime = Date.now();

  function checkAndRun() {
    if (started) return;
    var path = window.location.pathname.toLowerCase();
    var isMarketplace = path.indexOf('/marketplace/') >= 0;
    if (!isMarketplace) return;

    if (Date.now() - startTime > MAX_WAIT_MS) return;

    var anyInput = document.querySelector('input:not([type="hidden"]), textarea, select');
    if (!anyInput) {
      setTimeout(checkAndRun, 800);
      return;
    }

    chrome.runtime.sendMessage({ type: 'GET_MARKETPLACE_DATA' }, function (data) {
      if (data && data.title) {
        started = true;
        setTimeout(function () { autoFill(); }, 500);
      } else {
        setTimeout(checkAndRun, RETRY_INTERVAL);
      }
    });
  }

  startTime = Date.now();
  setTimeout(checkAndRun, 1500);

  var lastUrl = window.location.href;
  setInterval(function () {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (window.location.pathname.toLowerCase().indexOf('/marketplace/') >= 0) {
        started = false;
        startTime = Date.now();
        setTimeout(checkAndRun, 1000);
      }
    }
  }, 500);

  window.addEventListener('popstate', function () {
    if (window.location.pathname.toLowerCase().indexOf('/marketplace/') >= 0) {
      started = false;
      startTime = Date.now();
      setTimeout(checkAndRun, 1000);
    }
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'TRIGGER_AUTOFILL') {
      started = false;
      autoFill().then(function () { sendResponse({ ok: true }); });
      return true;
    }
    if (msg.type === 'DELETE_LISTING') {
      if (msg.url) window.location.href = msg.url;
      sendResponse({ ok: true });
    }
  });

  console.log('[Laujim] Content script listo en Facebook');
})();
