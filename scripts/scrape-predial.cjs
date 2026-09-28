#!/usr/bin/env node
/**
 * scrape-predial.cjs
 *
 * Consulta el portal Orion (Barranquilla) por referencia catastral y extrae
 * datos básicos del predio + vigencias con saldo (múltiples años).
 * Uso: node scripts/scrape-predial.cjs --ref <REFERENCIA>
 * Sin dependencias nuevas: fetch nativo + regex sobre HTML ISO-8859-1.
 */
const PREDIAL_URL = 'https://orion.barranquilla.gov.co:8787/Predial/BuscarPredioLiq.do?txtDato=REFCAT&txtTipoBusqueda=PorReferencia';

const LABELS = [
  ['referencia', 'Referencia Catastral:'],
  ['direccion', 'Dirección:'],
  ['postal', 'Código Postal:'],
  ['terreno', 'Área Terreno:'],
  ['construida', 'Área Construida:'],
  ['matricula', 'Matricula inmobiliaria:'],
  ['destino', 'Destino:'],
  ['estrato', 'Estrato:'],
];

function cleanText(raw) {
  return String(raw || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function fieldAfter(html, label) {
  const idx = html.indexOf(label);
  if (idx < 0) return '';
  const slice = html.slice(idx + label.length, idx + label.length + 900);
  const cells = [...slice.matchAll(/<td[^>]*>([^<>]*)<\/td>/g)]
    .map(z => cleanText(z[1].replace(/&nbsp;/g, ' ')))
    .filter(z => z);
  return cells[0] || '';
}

function parseVigencias(html) {
  const rows = [];
  const marks = [...html.matchAll(/value='(\d{4})01'/g)];
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k].index;
    const end = k + 1 < marks.length ? marks[k + 1].index : start + 15000;
    const chunk = html.slice(start, end);
    const yearMatch = chunk.match(/>(\d{4})<\/td>/);
    const nums = [];
    const numRe = /<td width="90%" align="right">([\d.]+)<\/td>/g;
    let numMatch;
    while ((numMatch = numRe.exec(chunk)) !== null && nums.length < 4) {
      nums.push(parseMoney(numMatch[1]));
    }
    if (yearMatch && nums.length === 4) {
      rows.push({
        vigencia: yearMatch[1],
        capital: nums[0],
        intereses: nums[1],
        descuento: nums[2],
        total: nums[3],
      });
    }
  }
  return rows;
}

async function scrapePredial(ref) {
  const cleanRef = String(ref || '').replace(/\s/g, '');
  if (!cleanRef) throw new Error('Falta la referencia catastral.');
  const res = await fetch(PREDIAL_URL.replace('REFCAT', encodeURIComponent(cleanRef)), {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Portal Orion respondió ${res.status}.`);
  const html = Buffer.from(await res.arrayBuffer()).toString('latin1');
  if (html.includes('Paz y Salvo')) {
    return { ref: cleanRef, datos: {}, vigencias: [], pazYSalvo: true, consultadoEn: new Date().toISOString() };
  }
  if (!html.includes('Referencia Catastral')) {
    throw new Error('Respuesta sin datos del predio (referencia inválida o portal caído).');
  }
  const datos = {};
  for (const [key, label] of LABELS) {
    datos[key] = fieldAfter(html, label);
  }
  const vigencias = parseVigencias(html);
  return { ref: cleanRef, datos, vigencias, consultadoEn: new Date().toISOString() };
}

async function main() {
  const idx = process.argv.indexOf('--ref');
  const ref = idx >= 0 ? process.argv[idx + 1] : '';
  try {
    const result = await scrapePredial(ref);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`[scrape-predial] ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { scrapePredial };
