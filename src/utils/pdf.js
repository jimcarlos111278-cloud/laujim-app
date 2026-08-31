import { jsPDF } from 'jspdf';

export function generateApartmentPDF(apartment, tenant, contract) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.text('Ficha del Apartamento', pageWidth / 2, 20, { align: 'center' });

  doc.setFontSize(14);
  doc.text(apartment.name, pageWidth / 2, 30, { align: 'center' });

  doc.setFontSize(10);
  let y = 45;

  doc.text(`Dirección / Ubicación: ${apartment.description || 'No especificada'}`, 14, y); y += 8;
  doc.text(`Canon de Arriendo: $${(apartment.monthlyRent || 0).toLocaleString()} COP`, 14, y); y += 8;
  doc.text(`Depósito: $${(apartment.depositAmount || 0).toLocaleString()} COP`, 14, y); y += 8;
  doc.text(`Día de Pago: ${apartment.paymentDueDay || 5} de cada mes`, 14, y); y += 8;
  doc.text(`Habitaciones: ${apartment.rooms || '-'}  |  Baños: ${apartment.bathrooms || '-'}  |  Área: ${apartment.area || '-'} m²`, 14, y); y += 8;
  doc.text(`Estado: ${apartment.status === 'occupied' ? 'OCUPADO' : 'VACANTE'}`, 14, y); y += 12;

  if (tenant) {
    doc.setFontSize(12);
    doc.text('Inquilino Actual', 14, y); y += 8;
    doc.setFontSize(10);
    doc.text(`Nombre: ${tenant.name || ''}`, 14, y); y += 8;
    doc.text(`Email: ${tenant.email || ''}`, 14, y); y += 8;
    doc.text(`Teléfono: ${tenant.phone || ''}`, 14, y); y += 8;
    doc.text(`Documento: ${tenant.documentId || ''}`, 14, y); y += 12;
  }

  if (contract) {
    doc.setFontSize(12);
    doc.text('Contrato Vigente', 14, y); y += 8;
    doc.setFontSize(10);
    doc.text(`Inicio: ${new Date(contract.startDate).toLocaleDateString('es-CO')}`, 14, y); y += 8;
    if (contract.endDate) {
      doc.text(`Fin: ${new Date(contract.endDate).toLocaleDateString('es-CO')}`, 14, y); y += 8;
    }
    doc.text(`Canon: $${(contract.monthlyRent || 0).toLocaleString()} COP`, 14, y); y += 8;
    doc.text(`Depósito Pagado: ${contract.depositPaid ? 'Sí' : 'No'}`, 14, y); y += 8;
    if (contract.terms) {
      doc.text('Términos:', 14, y); y += 6;
      const lines = doc.splitTextToSize(contract.terms, pageWidth - 28);
      doc.text(lines, 14, y); y += lines.length * 5;
    }
  }

  doc.save(`ficha-${apartment.name.replace(/\s+/g, '-')}.pdf`);
}

export function generatePublicHTML(apartmentsData) {
  const cards = apartmentsData.map(a => `
    <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);border:1px solid #e5e7eb;">
      <h3 style="margin:0 0 4px 0;font-size:1.2em;color:#1f2937;">${a.name}</h3>
      <p style="margin:0 0 12px 0;color:#6b7280;font-size:0.9em;">${a.description || 'Apartamento disponible'}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.9em;">
        <div><strong>Arriendo:</strong> $${(a.monthlyRent || 0).toLocaleString()}</div>
        <div><strong>Depósito:</strong> $${(a.depositAmount || 0).toLocaleString()}</div>
        <div><strong>Habitaciones:</strong> ${a.rooms || '-'}</div>
        <div><strong>Baños:</strong> ${a.bathrooms || '-'}</div>
        <div><strong>Área:</strong> ${a.area || '-'} m²</div>
        <div><strong>Piso:</strong> ${a.floor || '-'}</div>
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;color:#10b981;font-size:0.85em;font-weight:bold;">
        ✓ DISPONIBLE
      </div>
    </div>
  `).join('\n');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Apartamentos Disponibles</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f3f4f6; }
    .container { max-width: 1000px; margin: 0 auto; padding: 24px 16px; }
    h1 { text-align: center; color: #1f2937; margin-bottom: 8px; }
    .subtitle { text-align: center; color: #6b7280; margin-bottom: 32px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Apartamentos Disponibles</h1>
    <p class="subtitle">Conjunto Residencial - ${new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long' })}</p>
    <div class="grid">${cards}</div>
  </div>
</body>
</html>`;

  return html;
}
