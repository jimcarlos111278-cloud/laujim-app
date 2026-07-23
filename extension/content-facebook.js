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
    var items = document.querySelectorAll('select, [role="combobox"], button[aria-haspopup="listbox"], [role="button"][aria-expanded], [role="button"][aria-haspopup]');
    for (var i = 0; i < items.length; i++) {
      if (matchKeywords(items[i], keywords)) return items[i];
    }
    // Facebook suele dejar el texto de la etiqueta junto al botón, no dentro
    // del combobox. Busca un control interactivo en su contenedor cercano.
    var labels = document.querySelectorAll('label, span, div');
    for (var l = 0; l < labels.length; l++) {
      var labelText = (labels[l].textContent || '').trim().toLowerCase();
      if (!labelText || labelText.length > 100) continue;
      var matches = false;
      for (var k = 0; k < keywords.length; k++) {
        if (labelText.indexOf(keywords[k]) >= 0) { matches = true; break; }
      }
      if (!matches) continue;
      var container = labels[l];
      for (var level = 0; level < 3 && container; level++, container = container.parentElement) {
        var nearby = container.querySelectorAll('select, [role="combobox"], button[aria-haspopup="listbox"], [role="button"][aria-expanded], [role="button"][aria-haspopup]');
        for (var n = 0; n < nearby.length; n++) {
          if (nearby[n] !== labels[l]) return nearby[n];
        }
      }
    }
    return null;
  }

  function findEditable(keywords) {
    var all = getAllEditable();
    for (var i = 0; i < all.length; i++) {
      if (matchKeywords(all[i], keywords)) return all[i];
    }
    return null;
  }

  async function fillAndConfirmAddress(address) {
    if (!address) return true;
    var field = findEditable(['dirección', 'direccion', 'address', 'ubicación', 'ubicacion', 'location']);
    if (!field) {
      log('Could not find address field');
      return false;
    }
    setNativeValue(field, address);
    field.focus();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise(function (resolve) { setTimeout(resolve, 600); });
    var options = document.querySelectorAll('[role="option"], [role="listbox"] li, [role="listbox"] [role="button"]');
    for (var i = 0; i < options.length; i++) {
      var text = (options[i].textContent || '').trim();
      if (normalizeText(text).indexOf('ubicacion actual') >= 0) continue;
      if (text && !/ubicación actual|current location/i.test(text)) {
        options[i].click();
        log('Address suggestion selected: ' + text);
        return true;
      }
    }
    log('No address suggestion available yet');
    return false;
  }

  async function fillAndConfirmAddressReliable(address) {
    if (!address) return true;
    var field = findEditable(['direccion', 'address', 'ubicacion', 'location']);
    if (!field) {
      log('Could not find address field');
      return false;
    }
    field.focus();
    setNativeValue(field, address);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    for (var attempt = 0; attempt < 8; attempt++) {
      await new Promise(function (resolve) { setTimeout(resolve, 300); });
      var options = document.querySelectorAll('[role="option"], [role="listbox"] li, [role="listbox"] [role="button"]');
      for (var i = 0; i < options.length; i++) {
        var optionText = normalizeText(options[i].textContent || '');
        if (optionText && optionText.indexOf('ubicacion actual') < 0 && optionText.indexOf('current location') < 0) {
          options[i].click();
          log('Address suggestion selected: ' + (options[i].textContent || '').trim());
          return true;
        }
      }
    }
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    log('No address suggestion available yet');
    return false;
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
    var wanted = normalizeText(value);
    for (var attempt = 0; attempt < 8; attempt++) {
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
      var options = document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="radio"], [role="listbox"] li');
      for (var i = 0; i < options.length; i++) {
        var optionText = normalizeText(options[i].textContent || '');
        if (optionText === wanted || optionText.indexOf(wanted) >= 0 || wanted.indexOf(optionText) >= 0) {
          options[i].click();
          log('Selected dropdown ' + name + ': ' + value);
          return true;
        }
      }
    }
    log('Option not found for ' + name + ': ' + value);
    return false;
  }

  function normalizeText(value) {
    return String(value || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function setToggle(name, keywords, wanted) {
    var controls = document.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]');
    for (var i = 0; i < controls.length; i++) {
      if (!matchKeywords(controls[i], keywords)) continue;
      var checked = controls[i].tagName.toLowerCase() === 'input'
        ? controls[i].checked
        : controls[i].getAttribute('aria-checked') === 'true';
      if (checked !== Boolean(wanted)) controls[i].click();
      log('Set toggle ' + name + ': ' + Boolean(wanted));
      return true;
    }
    log('Could not find toggle: ' + name);
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
        var res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var blob = await res.blob();
        var ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        var file = new File([blob], 'foto_' + (i + 1) + '.' + ext, { type: blob.type || 'image/jpeg' });
        transfer.items.add(file);
      } catch (e) {
        log('Photo ' + (i + 1) + ' failed: ' + e.message);
      }
    }
    if (transfer.files.length === 0) return 0;
    var filesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (filesSetter && filesSetter.set) filesSetter.set.call(input, transfer.files);
    else Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
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
      { name: 'price per month', kw: ['price per month', 'precio por mes', 'monthly price'], val: data.price },
      { name: 'rental description', kw: ['rental description', 'descripción del alquiler', 'descripción'], val: data.description },
      { name: 'property square feet', kw: ['property square feet', 'square feet', 'pies cuadrados', 'metros cuadrados'], val: data.propertySquareFeet || data.area },
      { name: 'date available', kw: ['date available', 'availability', 'disponibilidad', 'fecha disponible'], val: data.availability },
    ];

    var filled = findAndSet(fields);
    log('Filled fields: ' + (filled.length ? filled.join(', ') : 'NONE'));

    var addressConfirmed = await fillAndConfirmAddressReliable(data.address);
    if (data.address && addressConfirmed) filled.push('address');

    // Facebook usa menús React para estos controles. Se seleccionan por el
    // texto visible de cada opción, no intentando escribir dentro del menú.
    var dropdowns = [
      { name: 'rental type', kw: ['tipo de alquiler', 'rental type', 'property type'], val: data.rentalType || 'Departamento/condominio' },
      { name: 'number of bedrooms', kw: ['número de habitaciones', 'numero de habitaciones', 'habitaciones', 'bedrooms'], val: data.bedrooms },
      { name: 'number of bathrooms', kw: ['número de baños', 'numero de banos', 'baños', 'banos', 'bathrooms'], val: data.bathrooms },
      { name: 'laundry type', kw: ['tipo de lavadero', 'lavadero', 'laundry type'], val: data.laundryType },
      { name: 'parking type', kw: ['tipo de estacionamiento', 'estacionamiento', 'parking type'], val: data.parkingType },
      { name: 'air conditioning type', kw: ['tipo de aire acondicionado', 'aire acondicionado', 'air conditioning type'], val: data.airConditioningType },
      { name: 'heating type', kw: ['tipo de calefacción', 'calefacción', 'heating type'], val: data.heatingType }
    ];
    for (var d = 0; d < dropdowns.length; d++) {
      if (await chooseDropdown(dropdowns[d].name, dropdowns[d].kw, dropdowns[d].val)) {
        filled.push(dropdowns[d].name);
      }
    }
    if (setToggle('cat friendly', ['se aceptan gatos', 'cat friendly', 'gatos'], data.catFriendly)) {
      filled.push('cat friendly');
    }
    if (setToggle('dog friendly', ['se aceptan perros', 'dog friendly', 'perros'], data.dogFriendly)) {
      filled.push('dog friendly');
    }

    var photoCount = 0;
    if (data.photoUrls && data.photoUrls.length > 0) {
      photoCount = await uploadPhotos(data.photoUrls);
      log('Uploaded photos: ' + photoCount);
    }

    var photosHandled = !data.photoUrls || data.photoUrls.length === 0 || photoCount > 0;
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
    if (filled.length > 0 && addressConfirmed && photosHandled) {
      chrome.runtime.sendMessage({ type: 'CLEAR_MARKETPLACE_DATA' });
    } else {
      log('Data retained: address or photos still need attention');
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
