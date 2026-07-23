(function () {
  'use strict';

  // Puede llegar desde el manifest y desde el respaldo del service worker.
  // Esta marca evita ejecutar dos auto-llenados en la misma pestaña.
  if (window.__LAUJIM_FACEBOOK_CONTENT_LOADED__) return;
  window.__LAUJIM_FACEBOOK_CONTENT_LOADED__ = true;

  var ATTEMPTS = 0;
  var MAX_ATTEMPTS = 60;
  var POLL_MS = 1500;

  function log(msg) {
    console.log('[Laujim] ' + msg);
  }

  function isSupportedCreationPage() {
    var path = window.location.pathname.toLowerCase();
    // Facebook cambia esta ruta según la cuenta, país y experimento activo.
    // La app publicada antigua abre housing; la nueva abre rental.
    return path.indexOf('/marketplace/create/rental') >= 0 ||
      path.indexOf('/marketplace/create/housing') >= 0;
  }

  function reportError(context, error) {
    var detail = error && error.message ? error.message : String(error || 'Error desconocido');
    console.error('[Laujim] ' + context + ': ' + detail, error);
    try {
      chrome.runtime.sendMessage({ type: 'REPORT_EXTENSION_ERROR', context: context, message: detail });
    } catch (ignored) {}
    var existing = document.getElementById('__LAUJIM_ERROR__');
    if (existing) existing.remove();
    var notice = document.createElement('div');
    notice.id = '__LAUJIM_ERROR__';
    notice.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:#b91c1c;color:white;padding:14px 18px;border-radius:12px;font-family:sans-serif;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,.35);max-width:420px;line-height:1.45;';
    notice.textContent = 'Laujim no pudo auto-llenar: ' + detail;
    (document.body || document.documentElement).appendChild(notice);
  }

  function safelyRunAutoFill(context, done) {
    autoFill().then(function () {
      if (done) done({ ok: true });
    }).catch(function (error) {
      reportError(context, error);
      if (done) done({ ok: false, error: error && error.message ? error.message : String(error) });
    });
  }

  log('Content script loaded, path: ' + window.location.pathname);

  function setNativeValue(el, val) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
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
    var labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/);
    for (var i = 0; i < labelledBy.length; i++) {
      var labelEl = document.getElementById(labelledBy[i]);
      if (labelEl) t += ' ' + (labelEl.textContent || '');
    }
    var p = el.parentElement;
    // Sólo el contenedor inmediato: subir hasta el formulario mezclaba las
    // etiquetas de todos los campos y podía llenar el campo equivocado.
    if (p) t += ' ' + (p.textContent || '');
    var prev = el.previousElementSibling;
    if (prev) t = (prev.textContent || '') + ' ' + t;
    var label = el.closest('label');
    if (label) t = (label.textContent || '') + ' ' + t;
    t += ' ' + (el.getAttribute('aria-label') || '');
    t += ' ' + (el.getAttribute('placeholder') || '');
    t += ' ' + (el.getAttribute('name') || '');
    return t.toLowerCase();
  }

  function findDropdown(keywords) {
    var items = document.querySelectorAll('select, [role="combobox"], button[aria-haspopup="listbox"]');
    for (var i = 0; i < items.length; i++) {
      if (matchKeywords(items[i], keywords)) return items[i];
    }
    return null;
  }

  async function chooseDropdown(name, keywords, value) {
    if (!value) return false;
    var control = findDropdown(keywords);
    if (!control) {
      log('Could not find dropdown: ' + name);
      return false;
    }
    if (control.tagName.toLowerCase() === 'select') {
      setNativeValue(control, value);
      return true;
    }
    control.click();
    await new Promise(function (resolve) { setTimeout(resolve, 250); });
    var options = document.querySelectorAll('[role="option"], [role="menuitemradio"], li');
    var wanted = String(value).trim().toLowerCase();
    for (var i = 0; i < options.length; i++) {
      var optionText = (options[i].textContent || '').trim().toLowerCase();
      if (optionText === wanted || optionText.indexOf(wanted) >= 0) {
        options[i].click();
        log('Selected dropdown ' + name + ': ' + value);
        return true;
      }
    }
    log('Option not found for ' + name + ': ' + value);
    return false;
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
    var input = null;
    var inputs = document.querySelectorAll('input[type="file"]');
    for (var ii = 0; ii < inputs.length; ii++) {
      if ((inputs[ii].getAttribute('accept') || '').indexOf('image') >= 0) { input = inputs[ii]; break; }
    }
    if (!input) input = inputs[0];
    if (!input) {
      log('No file input found for photos');
      return 0;
    }

    var transfer = new DataTransfer();
    for (var i = 0; i < photoUrls.length; i++) {
      var url = photoUrls[i];
      if (!url || url.indexOf('data:') === 0) continue;
      try {
        var res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var blob = await res.blob();
        var ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        var file = new File([blob], 'foto_' + (i + 1) + '.' + ext, { type: blob.type });
        transfer.items.add(file);
      } catch (e) {
        log('Photo ' + (i + 1) + ' failed: ' + e.message);
      }
    }
    if (transfer.files.length === 0) return 0;
    Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    log('Uploaded ' + transfer.files.length + ' photos via file input');
    return transfer.files.length;
  }

  async function autoFill() {
    log('autoFill() called');

    if (!isSupportedCreationPage()) {
      throw new Error('Facebook no abrió un formulario de vivienda. Inicia sesión y abre /marketplace/create/rental o /marketplace/create/housing.');
    }

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

    // El formulario de alquiler de Facebook usa un desplegable para el tipo
    // de inmueble; React no acepta asignarlo como un input normal.
    var rentalTypeSelected = await chooseDropdown(
      'rental type', ['rental type', 'property type', 'tipo de alquiler'],
      data.rentalType || 'Apartment/condo'
    );
    if (rentalTypeSelected) filled.push('rental type');

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

    // Conserva los datos si Facebook aún no terminó de cargar. Así se puede
    // pulsar “Auto-llenar ahora” desde el popup sin regresar a Laujim.
    if (filled.length > 0 || photoCount > 0) {
      chrome.runtime.sendMessage({ type: 'CLEAR_MARKETPLACE_DATA' });
    }
  }

  function checkAndRun() {
    var path = window.location.pathname.toLowerCase();
    var isCreationForm = isSupportedCreationPage();
    log('checkAndRun #' + ATTEMPTS + ' path=' + path + ' isHousingCreation=' + isCreationForm);

    if (!isCreationForm) return;

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
        setTimeout(function () { safelyRunAutoFill('auto-fill automático'); }, 800);
      } else {
        ATTEMPTS++;
        if (ATTEMPTS < MAX_ATTEMPTS) setTimeout(checkAndRun, POLL_MS);
      }
    });
  }

  var initialPath = window.location.pathname.toLowerCase();
  if (isSupportedCreationPage()) {
    log('On housing creation page, starting checks');
    setTimeout(checkAndRun, 2000);
  } else {
    log('Not on marketplace page, waiting for navigation');
  }

  var lastUrl = window.location.href;
  setInterval(function () {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      log('URL changed to: ' + window.location.pathname);
      if (isSupportedCreationPage()) {
        ATTEMPTS = 0;
        setTimeout(checkAndRun, 1500);
      }
    }
  }, 500);

  window.addEventListener('popstate', function () {
    log('popstate: ' + window.location.pathname);
    if (isSupportedCreationPage()) {
      ATTEMPTS = 0;
      setTimeout(checkAndRun, 1500);
    }
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'TRIGGER_AUTOFILL') {
      ATTEMPTS = 0;
      safelyRunAutoFill('auto-fill manual', sendResponse);
      return true;
    }
    if (msg.type === 'DELETE_LISTING') {
      if (msg.url) window.location.href = msg.url;
      sendResponse({ ok: true });
    }
  });

  log('Content script initialization complete');
})();
