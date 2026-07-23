(function () {
  'use strict';

  let autoFillAttempted = false;

  function getSelectors(field) {
    const map = {
      title: [
        'input[aria-label*="tulo" i]', 'input[aria-label*="title" i]',
        'input[placeholder*="tulo" i]', 'input[placeholder*="title" i]',
        'input[name*="title" i]', 'input[data-testid*="title" i]',
        'input[type="text"]:not([value])',
        'input[aria-label*="Título" i]', 'input[aria-label*="Titulo" i]',
        'label:has-text("Título") input', 'label:has-text("Title") input',
        'input.x1n2onr6:not([value=""])', 'input.x1n2onr6',
      ],
      price: [
        'input[aria-label*="precio" i]', 'input[aria-label*="price" i]',
        'input[placeholder*="precio" i]', 'input[placeholder*="price" i]',
        'input[name*="price" i]', 'input[data-testid*="price" i]',
        'input[type="text"][inputmode*="decimal" i]',
        'input[aria-label*="Precio" i]',
        'input.x1n2onr6[inputmode="decimal"]',
      ],
      description: [
        'textarea[aria-label*="descripci" i]', 'textarea[aria-label*="description" i]',
        'textarea[placeholder*="descripci" i]', 'textarea[placeholder*="description" i]',
        'textarea[name*="description" i]', 'textarea[data-testid*="description" i]',
        'div[aria-label*="descripci" i]', 'div[aria-label*="description" i]',
        'div[contenteditable="true"][aria-label*="descripci" i]',
        'div[contenteditable="true"][aria-label*="description" i]',
      ],
      bedrooms: [
        'input[aria-label*="habitacion" i]', 'input[aria-label*="bedroom" i]',
        'select[aria-label*="habitacion" i]', 'select[aria-label*="bedroom" i]',
        'input[name*="bedroom" i]', 'select[name*="bedroom" i]',
        'input[aria-label*="Cuartos" i]', 'input[aria-label*="Habitaciones" i]',
        'select[aria-label*="Cuartos" i]', 'select[aria-label*="Habitaciones" i]',
        'div[aria-label*="Habitaciones" i] select',
      ],
      bathrooms: [
        'input[aria-label*="baño" i]', 'input[aria-label*="bath" i]',
        'select[aria-label*="baño" i]', 'select[aria-label*="bath" i]',
        'input[name*="bath" i]', 'select[name*="bath" i]',
        'input[aria-label*="Baños" i]', 'input[aria-label*="Banos" i]',
        'select[aria-label*="Baños" i]', 'select[aria-label*="Banos" i]',
      ],
      area: [
        'input[aria-label*="metro" i]', 'input[aria-label*="square" i]',
        'input[aria-label*="area" i]', 'input[name*="area" i]',
        'input[aria-label*="tamaño" i]', 'input[aria-label*="size" i]',
        'input[aria-label*="Superficie" i]',
      ],
    };
    return map[field] || [];
  }

  function setFieldValue(el, val) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (proto && proto.set) {
        proto.set.call(el, val);
      } else {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } else if (tag === 'select') {
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } else if (el.isContentEditable) {
      el.textContent = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  function findAndSet(field, val) {
    if (!val && val !== 0) return false;
    const selectors = getSelectors(field);
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && setFieldValue(el, String(val))) return true;
    }
    return false;
  }

  function waitForElement(selector, timeout) {
    return new Promise(function (resolve) {
      if (document.querySelector(selector)) {
        return resolve(document.querySelector(selector));
      }
      var observer = new MutationObserver(function () {
        var el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      if (timeout) {
        setTimeout(function () {
          observer.disconnect();
          resolve(null);
        }, timeout);
      }
    });
  }

  function findFileInput() {
    var selectors = [
      'input[type="file"]',
      'input[accept*="image"]',
      'form input[type="file"]',
      'div[role="button"] input[type="file"]',
      'input[accept*="jpg" i], input[accept*="png" i], input[accept*="jpeg" i]',
    ];
    for (var s = 0; s < selectors.length; s++) {
      var el = document.querySelector(selectors[s]);
      if (el) return el;
    }
    return null;
  }

  async function uploadPhotos(photoUrls) {
    if (!photoUrls || photoUrls.length === 0) return false;
    var input = findFileInput();
    if (!input) return false;

    var dt = new DataTransfer();
    for (var i = 0; i < photoUrls.length; i++) {
      try {
        var res = await fetch(photoUrls[i], { mode: 'cors' });
        var blob = await res.blob();
        var ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        var file = new File([blob], 'foto_' + (i + 1) + '.' + ext, { type: blob.type });
        dt.items.add(file);
      } catch (e) {
        console.warn('[Laujim Ext] No se pudo descargar foto:', photoUrls[i]);
      }
    }

    if (dt.files.length === 0) return false;

    try {
      Object.defineProperty(input, 'files', {
        value: dt.files,
        configurable: true,
        writable: false,
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      console.warn('[Laujim Ext] Error al asignar fotos:', e);
      return false;
    }
  }

  async function autoFill() {
    if (autoFillAttempted) return;
    autoFillAttempted = true;

    var result = await chrome.runtime.sendMessage({ type: 'GET_MARKETPLACE_DATA' });
    if (!result) {
      console.log('[Laujim Ext] No hay datos de Marketplace guardados');
      return;
    }

    console.log('[Laujim Ext] Auto-llenando formulario...');

    var titleOk = findAndSet('title', result.title);
    var priceOk = findAndSet('price', result.price);
    var descOk = findAndSet('description', result.description);
    var bedOk = findAndSet('bedrooms', result.bedrooms);
    var bathOk = findAndSet('bathrooms', result.bathrooms);
    var areaOk = findAndSet('area', result.area);

    var photoOk = false;
    if (result.photoUrls && result.photoUrls.length > 0) {
      photoOk = await uploadPhotos(result.photoUrls);
    }

    var filled = [];
    if (titleOk) filled.push('Título');
    if (priceOk) filled.push('Precio');
    if (descOk) filled.push('Descripción');
    if (bedOk) filled.push('Habitaciones');
    if (bathOk) filled.push('Baños');
    if (areaOk) filled.push('Área');
    if (photoOk) filled.push('Fotos (' + result.photoUrls.length + ')');

    if (filled.length > 0) {
      var msg = document.createElement('div');
      msg.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;background:#059669;color:white;padding:16px 20px;border-radius:12px;font-family:sans-serif;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:320px;line-height:1.5;';
      msg.textContent = '✓ Laujim: ' + filled.join(', ') + ' rellenados';
      if (!photoOk && result.photoUrls && result.photoUrls.length > 0) {
        msg.textContent += '\n\n⚠ Fotos: pégalas manualmente (sube los archivos)';
      }
      document.body.appendChild(msg);
      setTimeout(function () { msg.remove(); }, 6000);
      chrome.runtime.sendMessage({ type: 'CLEAR_MARKETPLACE_DATA' });
    } else {
      console.log('[Laujim Ext] No se pudo rellenar ningún campo');
    }
  }

  var urlPath = window.location.pathname;
  if (urlPath.indexOf('/marketplace/create') >= 0 || urlPath.indexOf('/marketplace/listing/create') >= 0) {
    var observer = new MutationObserver(function () {
      if (document.querySelector('input[aria-label*="tulo" i]') ||
          document.querySelector('input[aria-label*="precio" i]') ||
          document.querySelector('textarea')) {
        observer.disconnect();
        setTimeout(autoFill, 500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 15000);
    setTimeout(autoFill, 2000);
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'TRIGGER_AUTOFILL') {
      autoFillAttempted = false;
      autoFill();
      sendResponse({ ok: true });
    }
    if (msg.type === 'DELETE_LISTING') {
      deleteListing(msg.url, sendResponse);
      return true;
    }
  });

  async function deleteListing(url) {
    if (!url) return;
    window.location.href = url;
    setTimeout(function () {
      var btns = document.querySelectorAll('div[role="button"], button, span, a');
      for (var b of btns) {
        if (b.textContent && (
          b.textContent.toLowerCase().indexOf('delete') >= 0 ||
          b.textContent.toLowerCase().indexOf('eliminar') >= 0 ||
          b.textContent.toLowerCase().indexOf('borrar') >= 0 ||
          b.textContent.indexOf('...') >= 0 ||
          b.textContent.indexOf('⋯') >= 0 ||
          b.getAttribute('aria-label') === 'More' ||
          b.getAttribute('aria-label') === 'Más'
        )) {
          b.click();
          break;
        }
      }
      setTimeout(function () {
        var confirmBtns = document.querySelectorAll('div[role="button"], button');
        for (var cb of confirmBtns) {
          if (cb.textContent && (
            cb.textContent.toLowerCase().indexOf('delete') >= 0 ||
            cb.textContent.toLowerCase().indexOf('eliminar') >= 0 ||
            cb.textContent.toLowerCase().indexOf('borrar') >= 0
          )) {
            cb.click();
            break;
          }
        }
      }, 2000);
    }, 3000);
  }

  console.log('[Laujim Ext] Content script listo en Facebook Marketplace');
})();
