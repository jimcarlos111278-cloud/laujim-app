(function () {
  'use strict';

  function normalizeText(value) {
    return String(value || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function visible(element) {
    if (!element) return false;
    var style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function setNativeValue(element, value) {
    if (!element || value === null || value === undefined || value === '') return false;
    var tag = element.tagName.toLowerCase();
    if (element.isContentEditable || element.getAttribute('role') === 'textbox') {
      element.focus();
      element.textContent = String(value);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    var prototype = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    element.focus();
    if (descriptor && descriptor.set) descriptor.set.call(element, String(value));
    else element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function nearbyText(element) {
    var text = [
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      element.getAttribute('name'),
    ].filter(Boolean).join(' ');
    var labelledBy = String(element.getAttribute('aria-labelledby') || '').split(/\s+/);
    labelledBy.forEach(function (id) {
      var label = document.getElementById(id);
      if (label) text += ' ' + (label.textContent || '');
    });
    var current = element;
    for (var level = 0; level < 3 && current; level += 1) {
      if (current.previousElementSibling) text += ' ' + (current.previousElementSibling.textContent || '');
      current = current.parentElement;
    }
    return normalizeText(text);
  }

  function editableElements() {
    return Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"], [role="textbox"]'
    )).filter(visible);
  }

  function findEditable(keywords) {
    var normalized = keywords.map(normalizeText);
    return editableElements().find(function (element) {
      var text = nearbyText(element);
      return normalized.some(function (keyword) { return text.indexOf(keyword) >= 0; });
    }) || null;
  }

  function activate(element) {
    if (!element) return;
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  function findControl(keywords) {
    var wanted = keywords.map(normalizeText);
    var candidates = Array.from(document.querySelectorAll('select, [role="combobox"], input[aria-haspopup], button, [role="button"]')).filter(visible);
    return candidates.find(function (element) {
      var text = nearbyText(element) + ' ' + normalizeText(element.textContent || '');
      return wanted.some(function (keyword) { return text.indexOf(keyword) >= 0; });
    }) || null;
  }

  async function choose(keywords, value) {
    if (!value) return false;
    var control = findControl(keywords);
    if (!control) return false;
    if (control.tagName.toLowerCase() === 'select') {
      control.value = String(value);
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    activate(control);
    var wanted = normalizeText(value);
    for (var attempt = 0; attempt < 12; attempt += 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
      var options = Array.from(document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="radio"], [role="listbox"] li')).filter(visible);
      var option = options.find(function (item) {
        var text = normalizeText(item.textContent || '');
        return text === wanted || text.indexOf(wanted) >= 0 || wanted.indexOf(text) >= 0;
      });
      if (option) {
        activate(option);
        await new Promise(function (resolve) { setTimeout(resolve, 350); });
        return true;
      }
    }
    return false;
  }

  async function fillAddress(address) {
    if (!address) return true;
    var field = document.querySelector('input[role="combobox"][aria-autocomplete="list"][type="text"]') ||
      findEditable(['direccion', 'address', 'ubicacion', 'location']);
    if (!field) return false;
    setNativeValue(field, address);
    for (var attempt = 0; attempt < 12; attempt += 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 300); });
      var options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li')).filter(visible);
      var option = options.find(function (item) {
        var text = normalizeText(item.textContent || '');
        return text && text.indexOf('ubicacion actual') < 0 && text.indexOf('current location') < 0;
      });
      if (option) {
        activate(option);
        return true;
      }
    }
    return false;
  }

  function setToggle(keywords, wanted) {
    var normalized = keywords.map(normalizeText);
    var controls = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]')).filter(visible);
    var control = controls.find(function (item) {
      var text = nearbyText(item);
      return normalized.some(function (keyword) { return text.indexOf(keyword) >= 0; });
    });
    if (!control) return false;
    var checked = control.tagName.toLowerCase() === 'input' ? control.checked : control.getAttribute('aria-checked') === 'true';
    if (checked !== Boolean(wanted)) activate(control);
    return true;
  }

  function findButton(labels) {
    var wanted = labels.map(normalizeText);
    var buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
    return buttons.find(function (button) {
      var text = normalizeText(button.textContent || button.getAttribute('aria-label') || '');
      return wanted.some(function (label) { return text === label || text.indexOf(label) >= 0; });
    }) || null;
  }

  function loginRequired() {
    var url = window.location.href.toLowerCase();
    if (/login|checkpoint|two_factor/.test(url)) return true;
    return Boolean(document.querySelector('input[name="email"], input[name="pass"], input[type="password"]'));
  }

  function currentListingUrl() {
    var match = window.location.href.match(/^https:\/\/(?:www\.|web\.|m\.)?facebook\.com\/marketplace\/item\/[^?#/]+/i);
    return match ? match[0] : '';
  }

  async function run(data, options) {
    options = options || {};
    if (loginRequired()) return { state: 'needs_login', message: 'Facebook requiere iniciar sesión o completar el 2FA.', url: window.location.href };
    if (!/\/marketplace\/create\/(rental|housing)/i.test(window.location.pathname)) {
      return { state: 'needs_review', message: 'Facebook no abrió el formulario de alquiler.', url: window.location.href };
    }

    var deadline = Date.now() + 90_000;
    while (editableElements().length === 0 && Date.now() < deadline) {
      await new Promise(function (resolve) { setTimeout(resolve, 1000); });
      if (loginRequired()) return { state: 'needs_login', message: 'Facebook requiere iniciar sesión o completar el 2FA.', url: window.location.href };
    }

    var fields = [
      { key: 'price', labels: ['precio por mes', 'price per month', 'monthly price'] },
      { key: 'description', labels: ['descripcion del alquiler', 'rental description', 'descripcion'] },
      { key: 'propertySquareFeet', labels: ['pies cuadrados', 'square feet', 'metros cuadrados', 'tamano de la propiedad'] },
      { key: 'availability', labels: ['fecha disponible', 'date available', 'disponibilidad'] },
      { key: 'bedrooms', labels: ['numero de habitaciones', 'habitaciones', 'bedrooms'] },
      { key: 'bathrooms', labels: ['numero de banos', 'banos', 'bathrooms'] },
    ];
    var filled = [];
    fields.forEach(function (field) {
      var element = findEditable(field.labels);
      if (element && setNativeValue(element, data[field.key] || (field.key === 'propertySquareFeet' ? data.area : ''))) filled.push(field.key);
    });

    var address = await fillAddress(data.address);
    if (address) filled.push('address');
    var dropdowns = [
      { key: 'rentalType', labels: ['tipo de alquiler', 'rental type', 'property type'] },
      { key: 'laundryType', labels: ['tipo de lavadero', 'lavadero', 'laundry type'] },
      { key: 'parkingType', labels: ['tipo de estacionamiento', 'estacionamiento', 'parking type'] },
      { key: 'airConditioningType', labels: ['tipo de aire acondicionado', 'aire acondicionado', 'air conditioning type'] },
      { key: 'heatingType', labels: ['tipo de calefaccion', 'calefaccion', 'heating type'] },
    ];
    for (var index = 0; index < dropdowns.length; index += 1) {
      if (await choose(dropdowns[index].labels, data[dropdowns[index].key])) filled.push(dropdowns[index].key);
    }
    setToggle(['se aceptan gatos', 'cat friendly', 'gatos'], data.catFriendly);
    setToggle(['se aceptan perros', 'dog friendly', 'perros'], data.dogFriendly);

    var photoInput = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
    if (data.photoUrls && data.photoUrls.length && !photoInput) {
      return { state: 'needs_review', message: 'Facebook no mostró el selector de fotos.', filled: filled };
    }
    if (photoInput && data.photoUrls && data.photoUrls.length) {
      window.LaujimMarketplaceBridge.requestPhotos();
      var photoDeadline = Date.now() + 90_000;
      while ((!photoInput.files || photoInput.files.length === 0) && Date.now() < photoDeadline) {
        await new Promise(function (resolve) { setTimeout(resolve, 500); });
      }
      if (!photoInput.files || photoInput.files.length === 0) {
        return { state: 'needs_review', message: 'No fue posible adjuntar las fotos del apartamento.', filled: filled };
      }
    }

    if (!address || !filled.includes('price') || !filled.includes('description')) {
      return { state: 'needs_review', message: 'Facebook cambió campos obligatorios; revisa el formulario abierto.', filled: filled };
    }

    if (!options.publish) return { state: 'needs_review', message: 'Formulario completado para revisión manual.', filled: filled };
    var next = findButton(['siguiente', 'next']);
    if (!next) return { state: 'needs_review', message: 'Formulario completado, pero no se encontró el botón Siguiente.', filled: filled };
    activate(next);
    await new Promise(function (resolve) { setTimeout(resolve, 1800); });

    var publishDeadline = Date.now() + 60_000;
    while (Date.now() < publishDeadline) {
      var publish = findButton(['publicar', 'publish']);
      if (publish && !publish.disabled && publish.getAttribute('aria-disabled') !== 'true') {
        activate(publish);
        break;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 700); });
    }

    var resultDeadline = Date.now() + 90_000;
    while (Date.now() < resultDeadline) {
      var listingUrl = currentListingUrl();
      if (listingUrl) return { state: 'published', message: 'Facebook confirmó la publicación.', listingUrl: listingUrl, filled: filled };
      if (loginRequired()) return { state: 'needs_login', message: 'Facebook solicitó una verificación adicional después de publicar.', filled: filled };
      await new Promise(function (resolve) { setTimeout(resolve, 1000); });
    }
    return { state: 'needs_review', message: 'Facebook recibió el formulario, pero no confirmó la URL del anuncio. Revísalo en la sesión local.', filled: filled };
  }

  window.LaujimMarketplaceWorker = { run: run };
})();
