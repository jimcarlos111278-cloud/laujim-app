(function () {
  'use strict';

  function normalizeText(value) {
    return String(value || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Some older queue payloads were produced through form-url-encoding. Decode
  // those values before writing them into Facebook so spaces stay spaces and
  // not visible plus signs ("hola+mundo").
  function decodeTransportText(value) {
    var text = String(value === null || value === undefined ? '' : value);
    if (!text || (!text.includes('+') && !text.includes('%'))) return text;
    try { return decodeURIComponent(text.replace(/\+/g, ' ')); }
    catch (_) { return text.replace(/\+/g, ' '); }
  }

  function facebookRentalType(value) {
    var normalized = normalizeText(value);
    if (!normalized || /departamento|apartamento|piso|condominio/.test(normalized)) return 'Apartamento o piso';
    return String(value);
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function emit(stage, message, details) {
    try {
      if (window.LaujimMarketplaceBridge && typeof window.LaujimMarketplaceBridge.stage === 'function') {
        window.LaujimMarketplaceBridge.stage(String(stage || 'marketplace'), String(message || ''), JSON.stringify(details || {}));
      }
    } catch (_) {}
  }

  function visible(element) {
    if (!element) return false;
    var style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && element.getClientRects().length > 0;
  }

  function setNativeValue(element, value) {
    if (!element || value === null || value === undefined || value === '') return false;
    var tag = element.tagName.toLowerCase();
    element.focus();
    if (element.isContentEditable || element.getAttribute('role') === 'textbox') {
      element.textContent = String(value);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    try {
      if (typeof element.select === 'function') element.select();
      if (document.execCommand('insertText', false, String(value))) {
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }
    } catch (_) {}
    var prototype = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(element, String(value));
    else element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function nearbyText(element) {
    var text = [
      element.getAttribute('aria-label'), element.getAttribute('placeholder'),
      element.getAttribute('name'), element.getAttribute('data-testid'), element.getAttribute('data-name')
    ].filter(Boolean).join(' ');
    String(element.getAttribute('aria-labelledby') || '').split(/\s+/).forEach(function (id) {
      var label = document.getElementById(id);
      if (label) text += ' ' + (label.textContent || '');
    });
    var current = element;
    for (var level = 0; level < 4 && current; level += 1) {
      if (current.getAttribute('data-name')) text += ' ' + current.getAttribute('data-name');
      if (current.previousElementSibling) text += ' ' + (current.previousElementSibling.textContent || '');
      if (current.parentElement) text += ' ' + (current.parentElement.getAttribute('aria-label') || '');
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
    var wanted = keywords.map(normalizeText);
    return editableElements().find(function (element) {
      var text = nearbyText(element);
      return wanted.some(function (keyword) { return text.indexOf(keyword) >= 0; });
    }) || null;
  }

  function activate(element) {
    if (!element) return;
    try { element.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {}
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    try { element.click(); } catch (_) {}
  }

  function findControl(keywords) {
    var wanted = keywords.map(normalizeText);
    return Array.from(document.querySelectorAll('select, [role="combobox"], input[aria-haspopup], button, [role="button"], [tabindex][data-action-id]'))
      .filter(visible)
      .find(function (element) {
        var text = nearbyText(element) + ' ' + normalizeText(element.textContent || '');
        return wanted.some(function (keyword) { return text.indexOf(keyword) >= 0; });
      }) || null;
  }

  async function choose(keywords, value) {
    if (!value) return false;
    var control = findControl(keywords);
    if (!control) return false;
    if (control.tagName.toLowerCase() === 'select') {
      var wanted = normalizeText(value);
      var option = Array.from(control.options || []).find(function (item) {
        var label = normalizeText(item.textContent || item.value || '');
        return label === wanted || label.indexOf(wanted) >= 0 || wanted.indexOf(label) >= 0;
      });
      control.value = option ? option.value : String(value);
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    activate(control);
    var normalizedValue = normalizeText(value);
    for (var attempt = 0; attempt < 20; attempt += 1) {
      await wait(250);
      var options = Array.from(document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="radio"], [role="listbox"] li')).filter(visible);
      var match = options.find(function (item) {
        var label = normalizeText(item.textContent || item.getAttribute('aria-label') || '');
        return label === normalizedValue || label.indexOf(normalizedValue) >= 0 || normalizedValue.indexOf(label) >= 0;
      });
      if (match) {
        activate(match);
        await wait(350);
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
    for (var attempt = 0; attempt < 25; attempt += 1) {
      await wait(300);
      var options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li')).filter(visible);
      var option = options.find(function (item) {
        var label = normalizeText(item.textContent || '');
        return label && label.indexOf('ubicacion actual') < 0 && label.indexOf('current location') < 0;
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
    var control = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]'))
      .filter(visible)
      .find(function (item) {
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
    return Array.from(document.querySelectorAll('button, [role="button"], a[role="button"], [tabindex][data-action-id]'))
      .filter(visible)
      .find(function (button) {
        var text = normalizeText((button.textContent || '') + ' ' + (button.getAttribute('aria-label') || ''));
        return wanted.some(function (label) { return text === label || text.indexOf(label) >= 0; });
      }) || null;
  }

  function findButtonFromEnd(labels) {
    var wanted = labels.map(normalizeText);
    var buttons = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"], [tabindex][data-action-id]'))
      .filter(visible)
      .filter(function (button) {
        var text = normalizeText((button.textContent || '') + ' ' + (button.getAttribute('aria-label') || ''));
        return wanted.some(function (label) { return text === label || text.indexOf(label) >= 0; });
      });
    return buttons.length ? buttons[buttons.length - 1] : null;
  }

  function findExactVisibleText(labels) {
    var wanted = labels.map(normalizeText);
    var candidates = Array.from(document.querySelectorAll(
      'button, [role="button"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="radio"], a, li, [tabindex]'
    )).filter(visible).filter(function (element) {
      var text = normalizeText(element.textContent || element.getAttribute('aria-label') || '');
      return wanted.some(function (label) { return text === label; });
    });
    candidates.sort(function (left, right) {
      return (left.textContent || '').length - (right.textContent || '').length;
    });
    return candidates[0] || null;
  }

  function hasMobileComposer() {
    return Boolean(
      findControl(['categoria', 'category']) &&
      findEditable(['que vendes', 'what are you selling', 'titulo del anuncio', 'listing title', 'title']) &&
      findEditable(['precio', 'price']) &&
      findEditable(['descripcion', 'description'])
    );
  }

  function hasWebRentalForm() {
    return Boolean(
      findControl(['tipo de propiedad en alquiler', 'tipo de alquiler', 'property type']) &&
      findEditable(['precio al mes', 'monthly price', 'price per month']) &&
      findEditable(['descripcion de la propiedad en alquiler', 'rental description'])
    );
  }

  async function selectMobileRentalCategory() {
    var control = findControl(['categoria', 'category']);
    if (!control) return false;
    var selectedText = control.tagName.toLowerCase() === 'select' && control.selectedOptions && control.selectedOptions[0]
      ? (control.selectedOptions[0].textContent || control.selectedOptions[0].value || '')
      : (control.textContent || '');
    var controlText = normalizeText(selectedText + ' ' + (control.getAttribute('aria-label') || ''));
    if (controlText.indexOf('alquiler') >= 0 || controlText.indexOf('rent') >= 0) return true;

    if (control.tagName.toLowerCase() === 'select') {
      var directOption = Array.from(control.options || []).find(function (option) {
        var label = normalizeText(option.textContent || option.value || '');
        return label === 'alquileres' || label.indexOf('alquiler') >= 0 || label.indexOf('rent') >= 0;
      });
      if (directOption) {
        control.value = directOption.value;
        control.dispatchEvent(new Event('change', { bubbles: true }));
        emit('mobile_category_selected', 'Facebook seleccionó la categoría Alquileres.', { mode: 'select' });
        return true;
      }
    }

    emit('mobile_category_opened', 'Abriendo la categoría de Marketplace del celular.', {});
    activate(control);
    await wait(500);
    var housing = findExactVisibleText(['vivienda', 'housing']);
    if (housing) {
      activate(housing);
      await wait(500);
    }
    var rental = findExactVisibleText(['alquileres', 'rentals', 'rent']);
    if (!rental) {
      var options = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, [tabindex]'))
        .filter(visible);
      rental = options.find(function (item) {
        var label = normalizeText(item.textContent || item.getAttribute('aria-label') || '');
        return label.indexOf('alquiler') >= 0 || label === 'rentals' || label === 'rent';
      }) || null;
    }
    if (rental) {
      activate(rental);
      await wait(1200);
      emit('mobile_category_selected', 'Facebook seleccionó Vivienda > Alquileres.', {});
      return true;
    }
    return false;
  }

  function loginRequired() {
    var url = window.location.href.toLowerCase();
    if (/login|checkpoint|two_factor|recover/.test(url)) return true;
    return Boolean(document.querySelector('input[name="email"], input[name="pass"], input[type="password"]'));
  }

  function currentListingUrl() {
    var match = window.location.href.match(/^https:\/\/(?:www\.|web\.|m\.)?facebook\.com\/marketplace\/item\/[^?#/]+/i);
    return match ? match[0] : '';
  }

  async function openRentalComposer() {
    if (/\/marketplace\/create\/(rental|housing|property)/i.test(window.location.pathname)) return true;
    if (hasMobileComposer()) {
      var mobileCategory = await selectMobileRentalCategory();
      if (mobileCategory || hasMobileComposer()) {
        emit('mobile_form_detected', 'Se detectó el formulario móvil de Marketplace.', { path: window.location.pathname });
        return true;
      }
    }
    if (!/\/marketplace\/(create|selling\/item)/i.test(window.location.pathname)) return false;
    var wanted = [
      'propiedad en alquiler', 'vivienda en alquiler', 'viviendas en venta o alquiler', 'alquiler o venta',
      'crear anuncio de alquiler', 'home for rent', 'property for rent',
      'housing for rent', 'rental listing'
    ].map(normalizeText);
    for (var attempt = 0; attempt < 45; attempt += 1) {
      if (loginRequired()) return false;
      if (hasMobileComposer() || hasWebRentalForm()) return true;
      var controls = Array.from(document.querySelectorAll('a, button, [role="button"], [role="menuitem"], [role="option"]')).filter(visible);
      var rental = controls.find(function (control) {
        var text = normalizeText((control.getAttribute('aria-label') || '') + ' ' + (control.textContent || ''));
        return wanted.some(function (label) { return text.indexOf(label) >= 0; });
      });
      if (rental) {
        emit('open_rental_form', 'Abriendo el tipo de anuncio Propiedad en alquiler.', { path: window.location.pathname });
        activate(rental);
        await wait(2500);
        if (/\/marketplace\/create\/(rental|housing|property)/i.test(window.location.pathname) || hasMobileComposer() || hasWebRentalForm()) return true;
      }
      await wait(750);
    }
    return hasMobileComposer() || hasWebRentalForm();
  }

  async function run(data, options) {
    options = options || {};
    emit('page_loaded', 'Facebook cargó la sesión local para iniciar la publicación.', {
      path: window.location.pathname, title: document.title || ''
    });
    if (loginRequired()) {
      emit('needs_login', 'Facebook requiere inicio de sesión o 2FA.', { path: window.location.pathname });
      return { state: 'needs_login', stage: 'needs_login', message: 'Facebook requiere iniciar sesión o completar el 2FA.', url: window.location.href };
    }
    if (!(await openRentalComposer())) {
      emit('rental_form_missing', 'No se encontró el formulario de propiedad en alquiler.', {
        path: window.location.pathname, editables: editableElements().length
      });
      return { state: 'needs_review', stage: 'rental_form_missing', message: 'Facebook no mostró el formulario de propiedad en alquiler. Se dejó el navegador abierto para revisarlo.', url: window.location.href };
    }

    var deadline = Date.now() + 90_000;
    while (editableElements().length === 0 && Date.now() < deadline) {
      await wait(1000);
      if (loginRequired()) return { state: 'needs_login', stage: 'needs_login', message: 'Facebook requiere iniciar sesión o completar el 2FA.', url: window.location.href };
    }
    emit('form_ready', 'Formulario de alquiler listo; completando el apartamento.', { editables: editableElements().length });

    var mobileComposer = hasMobileComposer();
    var fields = [
      { key: 'title', labels: ['que vendes', 'what are you selling', 'titulo del anuncio', 'listing title', 'title', 'titulo'] },
      { key: 'price', labels: ['precio por mes', 'precio', 'price per month', 'monthly price', 'price'] },
      { key: 'description', labels: ['descripcion del alquiler', 'rental description', 'descripcion', 'description'] },
      { key: 'location', labels: ['lugar', 'ubicacion', 'location', 'direccion', 'address'] },
      { key: 'propertySquareFeet', labels: ['pies cuadrados', 'square feet', 'metros cuadrados', 'tamano de la propiedad'] },
      { key: 'availability', labels: ['fecha disponible', 'date available', 'disponibilidad'] },
      { key: 'bedrooms', labels: ['numero de habitaciones', 'habitaciones', 'bedrooms'] },
      { key: 'bathrooms', labels: ['numero de banos', 'banos', 'bathrooms'] }
    ];
    var filled = [];
    fields.forEach(function (field) {
      var element = findEditable(field.labels);
      var suppliedValue = decodeTransportText(data[field.key]);
      var value = suppliedValue ||
        (field.key === 'title' ? ('Apartamento ' + decodeTransportText(data.apartmentName || 'en arriendo')) : '') ||
        (field.key === 'location'
          ? (data.address && data.city
            ? decodeTransportText(data.address) + ', ' + decodeTransportText(data.city)
            : decodeTransportText(data.address || data.city || 'Barranquilla'))
          : '') ||
        (field.key === 'propertySquareFeet' ? decodeTransportText(data.area) : '');
      if (element && setNativeValue(element, value)) filled.push(field.key);
    });

    var address = mobileComposer
      ? (filled.includes('location') || !findEditable(['lugar', 'ubicacion', 'location', 'direccion', 'address']) || await fillAddress(decodeTransportText(data.address || data.city || 'Barranquilla')))
      : await fillAddress(decodeTransportText(data.address));
    if (address && !filled.includes('location')) filled.push('address');
    var dropdowns = [
      { key: 'rentalType', labels: ['tipo de alquiler', 'rental type', 'property type'] },
      { key: 'laundryType', labels: ['tipo de lavadero', 'lavadero', 'laundry type'] },
      { key: 'parkingType', labels: ['tipo de estacionamiento', 'estacionamiento', 'parking type'] },
      { key: 'airConditioningType', labels: ['tipo de aire acondicionado', 'aire acondicionado', 'air conditioning type'] },
      { key: 'heatingType', labels: ['tipo de calefaccion', 'calefaccion', 'heating type'] }
    ];
    for (var index = 0; index < dropdowns.length; index += 1) {
      var dropdownValue = data[dropdowns[index].key];
      if (dropdowns[index].key === 'rentalType') dropdownValue = facebookRentalType(dropdownValue);
      if (await choose(dropdowns[index].labels, dropdownValue)) filled.push(dropdowns[index].key);
    }
    setToggle(['se aceptan gatos', 'cat friendly', 'gatos'], data.catFriendly);
    setToggle(['se aceptan perros', 'dog friendly', 'perros'], data.dogFriendly);

    var photoInput = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
    if (data.photoUrls && data.photoUrls.length && !photoInput) {
      var addPhotos = findButton(['añadir fotos', 'agregar fotos', 'add photos']);
      if (addPhotos) {
        emit('photo_button_opened', 'Abriendo el selector de fotos de Marketplace.', {});
        activate(addPhotos);
        await wait(700);
        photoInput = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
      }
      if (!photoInput) {
        emit('photo_input_missing', 'Facebook no mostró el selector de fotos.', { filled: filled });
        return { state: 'needs_review', stage: 'photo_input_missing', message: 'Facebook no mostró el selector de fotos.', filled: filled };
      }
    }
    if (photoInput && data.photoUrls && data.photoUrls.length) {
      var expectedPhotos = Math.min(10, data.photoUrls.length);
      emit('photos_requested', 'Preparando y adjuntando las fotos automáticamente.', { requested: expectedPhotos });
      window.LaujimMarketplaceBridge.requestPhotos();
      var photoDeadline = Date.now() + 90_000;
      while ((!photoInput.files || photoInput.files.length < expectedPhotos) && Date.now() < photoDeadline) await wait(500);
      if (!photoInput.files || photoInput.files.length === 0) {
        emit('photos_failed', 'El selector no recibió las fotos descargadas.', {});
        return { state: 'needs_review', stage: 'photos_failed', message: 'No fue posible adjuntar las fotos del apartamento.', filled: filled };
      }
      if (photoInput.files.length < expectedPhotos) {
        emit('photos_partial', 'Facebook recibió solo parte de las fotos automáticas.', { expected: expectedPhotos, attached: photoInput.files.length });
        return { state: 'needs_review', stage: 'photos_partial', message: 'Facebook no recibió todas las fotos automáticas; revisa el selector abierto.', filled: filled };
      }
      emit('photos_attached', 'Fotos adjuntadas automáticamente al formulario.', { attached: photoInput.files.length });
    }

    var requiredFieldsReady = mobileComposer
      ? filled.includes('title') && filled.includes('price') && filled.includes('description')
      : address && filled.includes('price') && filled.includes('description');
    if (!requiredFieldsReady) {
      emit('required_fields_missing', 'Facebook cambió o no aceptó un campo obligatorio.', { address: address, filled: filled });
      return { state: 'needs_review', stage: 'required_fields_missing', message: 'Facebook cambió campos obligatorios; revisa el formulario abierto.', filled: filled };
    }

    emit('form_completed', 'Datos obligatorios completados.', { filled: filled });
    if (!options.publish) return { state: 'needs_review', stage: 'form_completed', message: 'Formulario completado para revisión manual.', filled: filled };
    var next = mobileComposer ? findButtonFromEnd(['publicar', 'publish']) : findButton(['siguiente', 'next']);
    if (!next) return { state: 'needs_review', stage: 'next_missing', message: 'Formulario completado, pero no se encontró el botón Siguiente.', filled: filled };
    emit(mobileComposer ? 'publish_clicked' : 'next_clicked', mobileComposer ? 'Publicando el anuncio desde el formulario móvil.' : 'Avanzando a la revisión final.', { filled: filled });
    activate(next);
    await wait(2500);

    if (mobileComposer) {
      var mobileResultDeadline = Date.now() + 90_000;
      while (Date.now() < mobileResultDeadline) {
        var mobileListingUrl = currentListingUrl();
        var mobileBody = normalizeText(document.body && document.body.innerText || '');
        if (mobileListingUrl || /publicacion (creada|publicada)|anuncio (creado|publicado)|tu publicacion|listing (created|published)/.test(mobileBody)) {
          emit('published', 'Facebook confirmó la publicación móvil.', { listingUrl: mobileListingUrl });
          return { state: 'published', stage: 'published', message: 'Facebook confirmó la publicación.', listingUrl: mobileListingUrl, filled: filled };
        }
        if (loginRequired()) return { state: 'needs_login', stage: 'post_publish_verification', message: 'Facebook solicitó una verificación adicional después de publicar.', filled: filled };
        await wait(1000);
      }
      emit('confirmation_missing', 'Facebook recibió el formulario móvil, pero no confirmó la publicación.', { path: window.location.pathname });
      return { state: 'needs_review', stage: 'confirmation_missing', message: 'Facebook recibió el formulario, pero no confirmó la publicación. Revísala en el navegador local.', filled: filled };
    }

    var publishClicked = false;
    var publishDeadline = Date.now() + 60_000;
    while (Date.now() < publishDeadline) {
      var publish = findButton(['publicar', 'publish']);
      if (publish && !publish.disabled && publish.getAttribute('aria-disabled') !== 'true') {
        emit('publish_clicked', 'Botón Publicar encontrado; enviando el anuncio.', {});
        activate(publish);
        publishClicked = true;
        break;
      }
      await wait(700);
    }
    if (!publishClicked) return { state: 'needs_review', stage: 'publish_missing', message: 'Facebook no habilitó el botón Publicar. Revisa el formulario abierto.', filled: filled };

    var resultDeadline = Date.now() + 90_000;
    while (Date.now() < resultDeadline) {
      var listingUrl = currentListingUrl();
      if (listingUrl) {
        emit('published', 'Facebook confirmó la publicación.', { listingUrl: listingUrl });
        return { state: 'published', stage: 'published', message: 'Facebook confirmó la publicación.', listingUrl: listingUrl, filled: filled };
      }
      if (loginRequired()) return { state: 'needs_login', stage: 'post_publish_verification', message: 'Facebook solicitó una verificación adicional después de publicar.', filled: filled };
      await wait(1000);
    }
    emit('confirmation_missing', 'Facebook recibió la acción, pero no mostró una URL confirmada.', { path: window.location.pathname });
    return { state: 'needs_review', stage: 'confirmation_missing', message: 'Facebook recibió el formulario, pero no confirmó la URL del anuncio. Revísalo en la sesión local.', filled: filled };
  }

  window.LaujimMarketplaceWorker = { run: run };
})();
