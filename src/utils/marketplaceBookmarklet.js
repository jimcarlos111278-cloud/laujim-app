export function generateBookmarkletCode() {
  const code = `javascript:(function(){
  try {
    var d = JSON.parse(localStorage.getItem('laujim-marketplace'));
    if (!d) { alert('No hay datos de Laujim. Primero genera el anuncio en la app.'); return; }
    function setField(selectors, val) {
      if (!val) return;
      for (var s = 0; s < selectors.length; s++) {
        var el = document.querySelector(selectors[s]);
        if (el) {
          var tag = el.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea') {
            var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (nativeSetter && nativeSetter.set) { nativeSetter.set.call(el, val); }
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
    setField(['input[aria-label*="tulo" i]', 'input[aria-label*="title" i]', 'input[placeholder*="tulo" i]', 'input[placeholder*="title" i]', 'input[name*="title" i]', '#title_input', 'input[data-testid*="title" i]'], d.title);
    setField(['input[aria-label*="precio" i]', 'input[aria-label*="price" i]', 'input[placeholder*="precio" i]', 'input[placeholder*="price" i]', 'input[name*="price" i]', '#price_input', 'input[data-testid*="price" i]'], d.price);
    setField(['textarea[aria-label*="descripci" i]', 'textarea[aria-label*="description" i]', 'textarea[placeholder*="descripci" i]', 'textarea[placeholder*="description" i]', 'textarea[name*="description" i]', '#description_textarea', 'textarea[data-testid*="description" i]'], d.description);
    setField(['input[aria-label*="habitacion" i]', 'input[aria-label*="bedroom" i]', 'select[aria-label*="habitacion" i]', 'select[aria-label*="bedroom" i]', 'input[name*="bedroom" i]', 'select[name*="bedroom" i]'], d.bedrooms);
    setField(['input[aria-label*="baño" i]', 'input[aria-label*="bath" i]', 'select[aria-label*="baño" i]', 'select[aria-label*="bath" i]', 'input[name*="bath" i]', 'select[name*="bath" i]'], d.bathrooms);
    setField(['input[aria-label*="metro" i]', 'input[aria-label*="square" i]', 'input[aria-label*="area" i]', 'input[name*="area" i]', 'input[aria-label*="tamaño" i]', 'input[aria-label*="size" i]'], d.area);
    alert('Campos rellenados. Revisa y completa las fotos manualmente antes de publicar.');
  } catch(e) { alert('Error: ' + e.message); }
})();`;
  return code;
}
