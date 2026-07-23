(function () {
  'use strict';

  var MAX_RETRIES = 30;
  var RETRY_DELAY = 1000;

  function setNativeValue(el, val) {
    var proto = Object.getOwnPropertyDescriptor(
      el.tagName === 'INPUT' ? HTMLInputElement.prototype :
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype :
      null, 'value'
    );
    if (proto && proto.set) {
      proto.set.call(el, val);
    } else {
      el.value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  function findInput(labelPattern) {
    var inputs = document.querySelectorAll('input, textarea, select, div[contenteditable="true"]');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var aria = (el.getAttribute('aria-label') || '').toLowerCase();
      var ph = (el.getAttribute('placeholder') || '').toLowerCase();
      var name = (el.getAttribute('name') || '').toLowerCase();
      var testId = (el.getAttribute('data-testid') || '').toLowerCase();
      var label = '';
      var lbl = el.closest('label');
      if (lbl) label = lbl.textContent.toLowerCase();
      var parent = el.parentElement;
      if (parent) {
        var parentText = parent.textContent.toLowerCase();
        if (parentText.indexOf(labelPattern) >= 0 && el.tagName !== 'DIV') return el;
      }
      if (aria.indexOf(labelPattern) >= 0) return el;
      if (ph.indexOf(labelPattern) >= 0) return el;
      if (name.indexOf(labelPattern) >= 0) return el;
      if (testId.indexOf(labelPattern) >= 0) return el;
      if (label.indexOf(labelPattern) >= 0) return el;
    }
    return null;
  }

  function trySet(label, val) {
    if (val === undefined || val === null || val === '') return false;
    var el = findInput(label);
    if (!el) return false;
    try {
      if (el.tagName === 'SELECT') {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (el.isContentEditable) {
        el.textContent = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      setNativeValue(el, val);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function getData() {
    for (var attempt = 0; attempt < MAX_RETRIES; attempt++) {
      var result = await new Promise(function (resolve) {
        chrome.runtime.sendMessage({ type: 'GET_MARKETPLACE_DATA' }, resolve);
      });
      if (result && result.title) return result;
      await new Promise(function (r) { setTimeout(r, RETRY_DELAY); });
    }
    return null;
  }

  function findPhotoButton() {
    var buttons = document.querySelectorAll('div[role="button"], button, span[role="button"]');
    for (var i = 0; i < buttons.length; i++) {
      var text = buttons[i].textContent.toLowerCase();
      if (text.indexOf('add photo') >= 0 || text.indexOf('add photos') >= 0 ||
          text.indexOf('agregar foto') >= 0 || text.indexOf('añadir foto') >= 0 ||
          text.indexOf('subir foto') >= 0) {
        return buttons[i];
      }
    }
    return null;
  }

  function findFileInput() {
    var inputs = document.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      var accept = (inputs[i].getAttribute('accept') || '').toLowerCase();
      if (accept.indexOf('image') >= 0 || accept.indexOf('jpg') >= 0 || accept.indexOf('png') >= 0) return inputs[i];
    }
    return inputs[0] || null;
  }

  async function uploadPhotos(photoUrls) {
    if (!photoUrls || photoUrls.length === 0 || photoUrls[0] === '') return 0;

    var uploaded = 0;
    var fileInput = findFileInput();

    for (var i = 0; i < photoUrls.length; i++) {
      try {
        var res = await fetch(photoUrls[i], { mode: 'cors', credentials: 'omit' });
        if (!res.ok) continue;
        var blob = await res.blob();
        var ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');

        if (fileInput) {
          var dt = new DataTransfer();
          var file = new File([blob], 'foto_' + (i + 1) + '.' + ext, { type: blob.type });
          dt.items.add(file);
          try {
            Object.defineProperty(fileInput, 'files', {
              value: dt.files,
              configurable: true,
              writable: false,
            });
            fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            uploaded++;
            await new Promise(function (r) { setTimeout(r, 800); });
          } catch (e) {
            var btn = findPhotoButton();
            if (btn) {
              var dt2 = new DataTransfer();
              dt2.items.add(new File([blob], 'foto_' + (i + 1) + '.' + ext, { type: blob.type }));
              try {
                Object.defineProperty(btn.querySelector('input[type="file"]') || document.createElement('input'), 'files', {
                  value: dt2.files,
                  configurable: true,
                });
                btn.click();
                await new Promise(function (r) { setTimeout(r, 500); });
                uploaded++;
              } catch (e2) {}
            }
          }
        } else {
          var btn2 = findPhotoButton();
          if (btn2) {
            var hiddenInput = btn2.querySelector('input[type="file"]');
            if (!hiddenInput) {
              hiddenInput = document.createElement('input');
              hiddenInput.type = 'file';
              hiddenInput.accept = 'image/*';
              hiddenInput.multiple = true;
              hiddenInput.style.display = 'none';
              btn2.appendChild(hiddenInput);
            }
            var dt3 = new DataTransfer();
            dt3.items.add(new File([blob], 'foto_' + (i + 1) + '.' + ext, { type: blob.type }));
            try {
              Object.defineProperty(hiddenInput, 'files', {
                value: dt3.files,
                configurable: true,
              });
              btn2.click();
              await new Promise(function (r) { setTimeout(r, 500); });
              uploaded++;
            } catch (e3) {}
          }
        }
      } catch (e) {
        console.warn('[Laujim] Photo', i, 'failed:', e.message);
      }
    }
    return uploaded;
  }

  async function autoFill() {
    console.log('[Laujim] Buscando datos...');
    var data = await getData();
    if (!data) {
      console.log('[Laujim] No hay datos guardados');
      return;
    }

    console.log('[Laujim] Rellenando campos...');
    var fields = [
      { labels: ['título', 'title'], val: data.title },
      { labels: ['precio', 'price'], val: data.price },
      { labels: ['descripción', 'description', 'descripcion'], val: data.description },
      { labels: ['habitaciones', 'bedroom', 'cuartos'], val: data.bedrooms },
      { labels: ['baños', 'bath', 'banos'], val: data.bathrooms },
      { labels: ['metros', 'square', 'área', 'area', 'tamaño', 'size', 'superficie'], val: data.area },
    ];

    var filled = [];
    for (var f = 0; f < fields.length; f++) {
      for (var l = 0; l < fields[f].labels.length; l++) {
        if (trySet(fields[f].labels[l], fields[f].val)) {
          filled.push(fields[f].labels[l]);
          break;
        }
      }
    }

    var photoCount = 0;
    if (data.photoUrls && data.photoUrls.length > 0) {
      photoCount = await uploadPhotos(data.photoUrls);
    }

    var msgParts = [];
    if (filled.length > 0) msgParts.push('Campos: ' + filled.length);
    if (photoCount > 0) msgParts.push('Fotos: ' + photoCount);
    if (msgParts.length === 0) {
      console.log('[Laujim] No se pudo rellenar nada');
      return;
    }

    var msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;background:#059669;color:white;padding:16px 20px;border-radius:12px;font-family:sans-serif;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:360px;line-height:1.5;';
    msg.textContent = '✓ Laujim: ' + msgParts.join(' · ');
    document.body.appendChild(msg);
    setTimeout(function () { msg.remove(); }, 6000);

    chrome.runtime.sendMessage({ type: 'CLEAR_MARKETPLACE_DATA' });
  }

  var path = window.location.pathname.toLowerCase();
  var isCreatePage = path.indexOf('/marketplace/create') >= 0 || path.indexOf('/marketplace/listing/create') >= 0;

  if (isCreatePage) {
    if (document.readyState === 'complete') {
      setTimeout(autoFill, 1500);
    } else {
      window.addEventListener('load', function () {
        setTimeout(autoFill, 1500);
      });
    }
    var observer = new MutationObserver(function () {
      if (findInput('título') || findInput('precio')) {
        observer.disconnect();
        setTimeout(autoFill, 500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 20000);
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'TRIGGER_AUTOFILL') {
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
