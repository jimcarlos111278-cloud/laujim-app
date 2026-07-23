export function generateBookmarkletCode() {
  var code = `javascript:(function(){
  var raw = prompt('Pega el JSON del anuncio de Laujim (está en tu portapapeles):');
  if (!raw) return;
  var d;
  try { d = JSON.parse(raw); } catch(e) { alert('JSON inválido: ' + e.message); return; }
  function setField(selectors, val) {
    if (!val) return;
    for (var s = 0; s < selectors.length; s++) {
      var el = document.querySelector(selectors[s]);
      if (el) {
        var tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          var proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (proto && proto.set) { proto.set.call(el, val); }
          else { el.value = val; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (tag === 'select') {
          el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
    }
    return false;
  }
  setField(['input[aria-label*="tulo" i]', 'input[aria-label*="title" i]', 'input[placeholder*="tulo" i]', 'input[placeholder*="title" i]', 'input[name*="title" i]', 'input[data-testid*="title" i]', 'input[type="text"]:not([value])'], d.title);
  setField(['input[aria-label*="precio" i]', 'input[aria-label*="price" i]', 'input[placeholder*="precio" i]', 'input[placeholder*="price" i]', 'input[name*="price" i]', 'input[data-testid*="price" i]', 'input[type="text"][inputmode*="decimal" i]'], d.price);
  setField(['textarea[aria-label*="descripci" i]', 'textarea[aria-label*="description" i]', 'textarea[placeholder*="descripci" i]', 'textarea[placeholder*="description" i]', 'textarea[name*="description" i]', 'textarea[data-testid*="description" i]'], d.description);
  setField(['input[aria-label*="habitacion" i]', 'input[aria-label*="bedroom" i]', 'select[aria-label*="habitacion" i]', 'select[aria-label*="bedroom" i]', 'input[name*="bedroom" i]', 'select[name*="bedroom" i]'], d.bedrooms);
  setField(['input[aria-label*="baño" i]', 'input[aria-label*="bath" i]', 'select[aria-label*="baño" i]', 'select[aria-label*="bath" i]', 'input[name*="bath" i]', 'select[name*="bath" i]'], d.bathrooms);
  setField(['input[aria-label*="metro" i]', 'input[aria-label*="square" i]', 'input[aria-label*="area" i]', 'input[name*="area" i]', 'input[aria-label*="tamaño" i]', 'input[aria-label*="size" i]'], d.area);
  alert('Campos rellenados. Revisa y agrega las fotos manualmente.');
})();`;
  return code;
}

export function generateMarketplaceJson(apt, photoUrls) {
  return {
    title: 'Arriendo Apartamento ' + (apt.name || ''),
    price: String(apt.monthlyRent || 0),
    description: 'Apartamento ' + (apt.name || '') + ' en arriendo.\n' +
      (apt.rooms ? apt.rooms + ' habitaciones' : '') +
      (apt.bathrooms ? ', ' + apt.bathrooms + ' baños' : '') +
      (apt.area ? ', ' + apt.area + ' m²' : '') + '.\n' +
      'Canon: $' + Number(apt.monthlyRent || 0).toLocaleString('es-CO') + '/mes.\n' +
      (apt.description || '') + '\n\n' +
      'Para más información, contáctame.',
    bedrooms: String(apt.rooms || ''),
    bathrooms: String(apt.bathrooms || ''),
    area: String(apt.area || ''),
    photoUrls: photoUrls || [],
  };
}

export function generateMarketplaceJsonString(apt, photoUrls) {
  return JSON.stringify(generateMarketplaceJson(apt, photoUrls));
}
