async function fetchAsBase64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function buildApartmentsHTML({ apartments, photosByAptId, campusName }) {
  const cards = [];

  for (const a of apartments) {
    const aptPhotos = photosByAptId[a.id] || [];
    const photoImgs = [];

    for (const p of aptPhotos) {
      let src = p.data || null;
      if (!src && p.url) {
        const absUrl = p.url.startsWith('http') ? p.url : (window.location.origin + p.url);
        src = await fetchAsBase64(absUrl);
      }
      if (src) {
        photoImgs.push(`<img src="${src}" alt="${a.name}" loading="lazy" onerror="this.style.display='none'">`);
      }
    }

    const gallery = photoImgs.length > 0
      ? `<div class="gallery">${photoImgs.join('')}</div>`
      : '';

    const features = [];
    if (a.rooms) features.push(`<span>${a.rooms} hab</span>`);
    if (a.bathrooms) features.push(`<span>${a.bathrooms} baño</span>`);
    if (a.area) features.push(`<span>${a.area} m²</span>`);
    if (a.floor) features.push(`<span>Piso ${a.floor}</span>`);
    const featureRow = features.length > 0
      ? `<div class="features">${features.join('')}</div>`
      : '';

    cards.push(`
    <div class="card">
      <div class="card-body">
        <h2>${a.name}</h2>
        ${a.description ? `<p class="desc">${a.description}</p>` : ''}
        ${featureRow}
        <div class="pricing">
          <div class="price-row"><span>Arriendo</span><strong>$${(a.monthlyRent || 0).toLocaleString()}</strong></div>
          <div class="price-row"><span>Depósito</span><strong>$${(a.depositAmount || 0).toLocaleString()}</strong></div>
        </div>
        ${a.paymentDueDay ? `<div class="due">D\u00eda de pago: ${a.paymentDueDay} de cada mes</div>` : ''}
        ${a.notes ? `<div class="notes">${a.notes}</div>` : ''}
        <div class="badge">DISPONIBLE</div>
      </div>
      ${gallery}
    </div>`);
  }

  const campus = campusName || 'Conjunto Residencial';
  const today = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Apartamentos Disponibles - ${campus}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background: #f0f2f5; color: #1f2937; line-height: 1.6; }
.container { max-width: 800px; margin: 0 auto; padding: 32px 20px; }
.header { text-align: center; margin-bottom: 48px; padding: 0 16px; }
.header h1 { font-size: 2em; font-weight: 700; color: #111827; margin-bottom: 6px; }
.header p { color: #6b7280; font-size: 1em; }
.card { background: #fff; border-radius: 20px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); margin-bottom: 40px; }
.gallery { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.gallery img { max-width: 100%; height: 300px; object-fit: contain; display: block; background: #f3f4f6; }
.card-body { padding: 24px; }
.card-body h2 { font-size: 1.5em; font-weight: 700; margin-bottom: 8px; color: #111827; }
.desc { color: #4b5563; font-size: 0.95em; margin-bottom: 16px; line-height: 1.5; }
.features { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.features span { font-size: 0.85em; background: #f3f4f6; color: #374151; padding: 6px 14px; border-radius: 999px; }
.pricing { border-top: 1px solid #e5e7eb; padding-top: 16px; margin-bottom: 12px; }
.price-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 1em; }
.price-row strong { color: #059669; font-size: 1.15em; }
.due { font-size: 0.85em; color: #6b7280; margin-bottom: 12px; padding: 8px 12px; background: #f9fafb; border-radius: 8px; display: inline-block; }
.notes { font-size: 0.9em; color: #4b5563; margin-bottom: 16px; padding: 12px 16px; background: #f9fafb; border-radius: 8px; border-left: 3px solid #3b82f6; }
.badge { display: inline-block; background: #d1fae5; color: #065f46; font-weight: 700; font-size: 0.85em; padding: 6px 16px; border-radius: 999px; letter-spacing: 0.02em; }
.footer { text-align: center; padding: 40px 0; color: #9ca3af; font-size: 0.85em; }
@media (max-width: 640px) { .container { padding: 20px 12px; } .card-body { padding: 16px; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${campus}</h1>
    <p>Apartamentos disponibles · ${today}</p>
  </div>
  <div class="grid">${cards.join('')}</div>
  <div class="footer">Generado por Laujim App · ${today}</div>
</div>
</body>
</html>`;
}
