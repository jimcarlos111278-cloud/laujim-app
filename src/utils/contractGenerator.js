import { jsPDF } from 'jspdf';

const UNIDADES = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const DECENAS = ["", "diez", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const ESPECIALES = {
  10: "diez", 11: "once", 12: "doce", 13: "trece", 14: "catorce", 15: "quince",
  16: "dieciseis", 17: "diecisiete", 18: "dieciocho", 19: "diecinueve",
  20: "veinte", 21: "veintiun", 22: "veintidos", 23: "veintitres", 24: "veinticuatro",
  25: "veinticinco", 26: "veintiseis", 27: "veintisiete", 28: "veintiocho", 29: "veintinueve",
};
const CIENTOS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function centenasALetras(n) {
  if (n === 0) return "";
  if (n === 100) return "cien";
  if (n < 10) return UNIDADES[n];
  if (n < 30) return ESPECIALES[n];
  if (n < 100) {
    const d = Math.floor(n / 10), u = n % 10;
    return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${UNIDADES[u]}`;
  }
  const c = Math.floor(n / 100), r = n % 100;
  return r === 0 ? CIENTOS[c] : `${CIENTOS[c]} ${centenasALetras(r)}`;
}

function numeroALetras(valor) {
  const n = Math.floor(Number(valor));
  if (n === 0) return "cero pesos";
  const millones = Math.floor(n / 1000000);
  const resto = n % 1000000;
  const miles = Math.floor(resto / 1000);
  const unidades = resto % 1000;
  const partes = [];
  if (millones === 1) partes.push("un millon");
  else if (millones > 1) partes.push(`${centenasALetras(millones)} millones`);
  if (miles === 1) partes.push("mil");
  else if (miles > 1) partes.push(`${centenasALetras(miles)} mil`);
  if (unidades > 0) partes.push(centenasALetras(unidades));
  return partes.join(" ") + " pesos";
}

function formatearPesos(valor) {
  return String(valor).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseFecha(texto) {
  const match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error("La fecha debe tener formato dd/mm/aaaa");
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function fechaTexto(fecha) {
  const d = fecha.getDate().toString().padStart(2, '0');
  const m = (fecha.getMonth() + 1).toString().padStart(2, '0');
  const y = fecha.getFullYear();
  return `${d}/${m}/${y}`;
}

function fechaEnLetras(fecha) {
  const dia = fecha.getDate() === 1 ? "primero" : centenasALetras(fecha.getDate());
  return `${dia} de ${MESES[fecha.getMonth() + 1]} del ${fecha.getFullYear()}`;
}

function sumarMeses(fecha, meses) {
  const totalMonth = fecha.getMonth() + meses;
  const y = fecha.getFullYear() + Math.floor(totalMonth / 12);
  const m = totalMonth % 12;
  const d = Math.min(fecha.getDate(), 28);
  return new Date(y, m, d);
}

function limpiarNumero(valor) {
  const texto = String(valor).replace(/[$. ]/g, '').trim();
  const n = Number(texto);
  if (isNaN(n)) throw new Error("El valor debe ser numerico");
  return n;
}

const CLAUSULAS = [
  (d) => {
    let coPart = '';
    if (d.co_arrendatarios && d.co_arrendatarios.length > 0) {
      const coNames = d.co_arrendatarios.filter(c => c.nombre).map(c => `**${c.nombre}**, identificado con CC **${c.cedula || ''}** expedida en **${c.expedida || 'Soledad'}**`);
      if (coNames.length > 0) coPart = ', y como co-arrendatarios ' + coNames.join(', ');
    }
    return `**${d.propietario_nombre}**, quien se identifica con la cedula de ciudadania numero **${d.propietario_cedula}** expedida en **${d.propietario_expedida}**, quien obra en nombre propio y que para efectos de este contrato se denominara el "Arrendador", por una parte, y por la otra, **${d.arrendatario_nombre}**, quien se identifica con la cedula de ciudadania numero **${d.arrendatario_cedula}** expedida en **${d.arrendatario_expedida}**, quien para efectos de este contrato obra en nombre propio y se denominara el "Arrendatario"${coPart}, manifestaron que han decidido celebrar un contrato de arrendamiento de bien inmueble destinado a vivienda, en adelante el "Contrato", el cual se regira por las siguientes clausulas.`;
  },
  (d) => `Primera. - Objeto: Por medio del presente Contrato, el Arrendador entrega a titulo de arrendamiento al Arrendatario el siguiente bien inmueble: APTO # **${d.apto}** con todas sus anexidades y dependencias, ubicada en la **${d.direccion}**, jurisdiccion del distrito de Barranquilla, departamento del Atlantico, destinado para el uso de vivienda de la Arrendataria y la de su familia.`,
  (d) => `Segunda. - Canon de Arrendamiento: El canon de arrendamiento mensual es la suma de **${numeroALetras(d.canon)}** (**$${formatearPesos(d.canon)}**) MONEDA LEGAL COLOMBIANA. El Arrendatario tambien entregara un deposito de **${numeroALetras(d.deposito)}** (**$${formatearPesos(d.deposito)}**), destinado a cubrir restauraciones del inmueble por deterioro natural, tales como mantenimiento de pintura y demas reparaciones necesarias. Estas sumas seran pagadas por el Arrendatario anticipadamente al Arrendador o a su orden, al numero de cuenta de Ahorros Bancolombia **${d.cuenta}**, a nombre de **${d.propietario_nombre}**, identificado con cedula de ciudadania No. **${d.propietario_cedula}** expedida en **${d.propietario_expedida}**, en la fecha pactada para los pagos, correspondiente al dia de inicio del contrato **${fechaEnLetras(d.inicio)} (${fechaTexto(d.inicio)})**, con periodicidad mensual.`,
  () => 'Paragrafo 1: La tolerancia del Arrendador en recibir el pago del canon de arrendamiento con posterioridad al plazo indicado para ello en esta Clausula, no podra entenderse, en ningun caso, como animo del Arrendador de modificar el termino establecido en este Contrato para el pago del canon.',
  (d) => `Tercera. - Vigencia: El arrendamiento tendra una duracion de **${centenasALetras(d.meses)} (${d.meses}) meses**, contada a partir del **${fechaEnLetras(d.inicio)} (${fechaTexto(d.inicio)})**. De acuerdo con la duracion pactada, el periodo inicial vencera el **${fechaEnLetras(d.fin)} (${fechaTexto(d.fin)})** y la fecha maxima para que cualquiera de las Partes informe a la otra su decision de no prorrogar el Contrato sera el **${fechaEnLetras(d.aviso)} (${fechaTexto(d.aviso)})**, esto es, con tres (3) meses de anticipacion al vencimiento. Si ninguna de las Partes realiza dicho aviso a mas tardar en esa fecha, el Contrato se prorrogara automaticamente por una vigencia igual a la inicial, es decir, por otros **${centenasALetras(d.meses)} (${d.meses}) meses**, contados a partir del vencimiento del periodo anterior.`,
  () => 'Cuarta. - Entrega: El Arrendatario en la fecha de suscripcion de este documento declara (i) recibir el Inmueble de manos del Arrendador en perfecto estado, de conformidad con el inventario elaborado por las Partes y que forma parte integrante de este Contrato en calidad de Anexo 1.',
  () => 'Quinta. - Reparaciones: Los danos que se ocasionen al Inmueble por el Arrendatario, por responsabilidad suya o de sus dependientes, seran reparados y cubiertos sus costos de reparacion en su totalidad por la Arrendataria. Igualmente, la Arrendataria se obliga a cumplir con las obligaciones previstas en los articulos 2029 y 2030 del Codigo Civil.',
  () => 'Paragrafo: El Arrendataria se abstendra de hacer mejoras de cualquier clase al Inmueble sin permiso previo y escrito del Arrendador. Las mejoras al Inmueble seran del propietario del Inmueble y no habra lugar al reconocimiento del precio, costo o indemnizacion alguna al Arrendatario por las mejoras realizadas. Las mejoras no podran retirarse salvo que el Arrendador lo exija por escrito, a lo que el Arrendatario accedera inmediatamente a su costa, dejando el Inmueble en el mismo buen estado en que lo recibio del Arrendador, salvo el deterioro natural por el uso legitimo.',
  () => 'Sexta. - Servicios Publicos: El arrendatario pagara oportuna y totalmente los servicios publicos del Inmueble (Luz, Gas y Agua) desde la fecha en que comience el arrendamiento hasta la restitucion del Inmueble. Si el Arrendatario no paga los servicios publicos a su cargo, el Arrendador podra hacerlo para evitar que los servicios publicos sean suspendidos. El incumplimiento del Arrendatario en el pago oportuno de los servicios publicos del Inmueble se tendra como incumplimiento del Contrato y el Arrendatario debera cancelar de manera incondicional e irrevocable al Arrendador las sumas que por este concepto haya tenido que pagar el Arrendador, pago que debera hacerse de manera inmediata por el Arrendatario contra la presentacion de las facturas correspondientes por parte del Arrendador.',
  () => 'Paragrafo 1: El Arrendatario declara que ha recibido en perfecto estado de funcionamiento y de conservacion las instalaciones para uso de los servicios publicos del Inmueble, que se abstendra de modificarlas sin permiso previo y escrito del Arrendador y que respondera por danos y/o violaciones de los reglamentos de las correspondientes empresas de servicios publicos.',
  () => 'Septima. - Destinacion: El Arrendatario, durante la vigencia del Contrato, destinara el Inmueble unica y exclusivamente para su vivienda y la de su familia. En ningun caso la Arrendataria podra subarrendar o ceder en todo o en parte este arrendamiento, so pena de que el Arrendador pueda dar por terminado validamente el Contrato en forma inmediata, sin lugar a indemnizacion alguna en favor del arrendatario y podra exigir la devolucion del Inmueble sin necesidad de ningun tipo de requerimiento previo por parte del Arrendador. Igualmente, el Arrendatario se abstendra de guardar o permitir que dentro del Inmueble se guarden elementos inflamables, toxicos, insalubres, explosivos o danosos para la conservacion, higiene, seguridad y estetica del inmueble y en general de sus ocupantes permanentes o transitorios.',
  () => 'Octava. - Restitucion: Terminado el contrato en los terminos establecidos en el presente documento y de conformidad con la ley, el Arrendatario (i) restituira el Inmueble al Arrendador en las mismas buenas condiciones en que lo recibio del Arrendador, salvo el deterioro natural causado por el uso legitimo, (ii) entregara al Arrendador los ejemplares originales de las facturas de cobro por concepto de servicios publicos del Inmueble correspondientes a los ultimos tres (3) meses, debidamente canceladas por el Arrendatario, bajo el entendido que hara entrega de dichas facturas en el domicilio del Arrendador, con una antelacion de Cinco (5) dias habiles a la fecha fijada para la restitucion material del Inmueble al Arrendador.',
  () => 'Novena. - Renuncia: El Arrendatario declara que (i) no ha tenido ni tiene posesion del Inmueble, y (ii) que renuncia en beneficio del Arrendador o de su cesionario, a todo requerimiento para constituirlo en mora en el cumplimiento de las obligaciones a su cargo derivadas de este Contrato.',
  () => 'Decima. - Cesion: El Arrendatario faculta al Arrendador a ceder total o parcialmente este Contrato y declara al cedente del Contrato, es decir al Arrendador, libre de cualquier responsabilidad como consecuencia de la cesion que haga de este Contrato.',
  () => 'Decima Primera. - Incumplimiento: El incumplimiento del Arrendatario a cualquiera de sus obligaciones legales o contractuales faculta al Arrendador para ejercer las siguientes acciones, simultaneamente o en el orden que el elija: (i) Declarar terminado este Contrato y reclamar la devolucion del Inmueble judicial y/o extrajudicialmente. (ii) Exigir y perseguir a traves de cualquier medio, judicial o extrajudicialmente, al Arrendatario y/o coarrendatarios por el monto de los perjuicios resultantes del incumplimiento, asi como de la multa por incumplimiento pactada en este Contrato.',
  () => 'Decima Segunda. - Validez: El presente Contrato anula todo convenio anterior relativo al arrendamiento de este Inmueble y solamente podra ser modificado por escrito suscrito por las Partes.',
  () => 'Decima Tercera. - Merito Ejecutivo: El Arrendatario declara de manera expresa que reconoce y acepta que este Contrato presta merito ejecutivo para exigir del Arrendatario y a favor del Arrendador el pago de (i) los canones de arrendamiento causados y no pagados por el Arrendatario, (ii) las multas y sanciones que se causen por el incumplimiento del Arrendatario de cualquiera de las obligaciones a su cargo en virtud de la ley o de este Contrato, (iii) las sumas causadas y no pagadas por el Arrendatario por concepto de servicios publicos del Inmueble, cuotas de administracion y cualquier otra suma de dinero que por cualquier concepto deba ser pagada por el Arrendatario.',
  () => 'Decima Cuarta. - Costos: Cualquier costo que se cause con ocasion de la celebracion o prorroga de este Contrato, incluyendo el impuesto de timbre, sera asumido en su integridad por el Arrendatario.',
  () => 'Decima Quinta. - Preaviso: El Arrendador podra dar por terminado el presente Contrato de conformidad con los articulos 22 y 23 del capitulo VII de la ley 820 de 2003.',
  (_d) => `Decima sexta. - Clausula Penal: En el evento de incumplimiento cualquiera de las Partes a las obligaciones a su cargo contenidas en la ley o en este Contrato, la Parte incumplida debera pagar a la otra Parte una suma equivalente a Dos (2) canon de arrendamiento vigentes en la fecha del incumplimiento, a titulo de pena. En el evento que los perjuicios ocasionados por la Parte incumplida excedan el valor de la suma aqui prevista como pena, la Parte incumplida debera pagar a la otra Parte la diferencia entre el valor total de los perjuicios y el valor de la pena prevista en esta Clausula.`,
  () => 'Decima Septima. - Abandono: El Arrendatario autoriza de manera expresa e irrevocable al Arrendador para ingresar al Inmueble y recuperar su tenencia, con el solo requisito de la presencia de dos (2) testigos, en procura de evitar el deterioro o desmantelamiento del Inmueble, en el evento que por cualquier causa o circunstancia el Inmueble permanezca abandonado o deshabitado por el termino de dos (2) meses o mas y que la exposicion al riesgo sea tal que amenace la integridad fisica del bien o la seguridad del vecindario.',
  () => 'Decima octava. - Recibos de pago de servicios publicos: El Arrendador en cualquier tiempo durante la vigencia de este Contrato, podra exigir del Arrendatario la presentacion de las facturas de los servicios publicos del Inmueble a fin de verificar la cancelacion de estos. En el evento que el Arrendador llegare a comprobar que alguna de las facturas no ha sido pagada por el Arrendatario encontrandose vencido el plazo para el pago previsto en la respectiva factura, el Arrendador podra terminar de manera inmediata este Contrato y exigir del Arrendatario el pago de las sumas a que hubiere lugar.',
  (d) => `Para constancia el presente Contrato es suscrito en el Distrito de Barranquilla el dia (**${fechaTexto(d.inicio)}**), en Dos (2) ejemplares.`,
];

export function generateContractPDF(data) {
  const canon = limpiarNumero(data.canon);
  const deposito = limpiarNumero(data.deposito);
  const meses = Number(data.meses) || 12;
  const inicio = parseFecha(data.fecha_inicio);
  const fin = sumarMeses(inicio, meses);
  const aviso = sumarMeses(fin, -3);

  const d = {
    ...data,
    canon,
    deposito,
    meses,
    inicio,
    fin,
    aviso,
  };

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'letter' });
  const ML = 18, MR = 18, MT = 14, MB = 18;
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const textW = PW - ML - MR;
  const indent = 5;
  const lh = 5.2;
  let y = MT;
  let page = 1;

  function checkPage(h) {
    if (y + h > PH - MB) {
      doc.addPage();
      page++;
      y = MT;
    }
  }

  function write(text, bold) {
    doc.setFont('Helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, textW - indent);
    for (const line of lines) {
      checkPage(lh);
      doc.text(line, ML + indent, y);
      y += lh;
    }
  }

  function writeCentered(text, bold, size) {
    doc.setFontSize(size);
    doc.setFont('Helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, textW);
    for (const line of lines) {
      checkPage(lh + 2);
      const tw = doc.getTextWidth(line);
      doc.text(line, (PW - tw) / 2, y);
      y += size * 0.35 + 1;
    }
  }

  function richText(text) {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    let x = ML + indent;
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    let lineStartY = y;
    for (const part of parts) {
      if (!part) continue;
      const isBold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
      const clean = part.replace(/^\*\*|\*\*$/g, '');
      doc.setFont('Helvetica', isBold ? 'bold' : 'normal');
      const words = clean.split(' ');
      for (let i = 0; i < words.length; i++) {
        const word = words[i] + (i < words.length - 1 ? ' ' : '');
        const ww = doc.getTextWidth(word);
        if (x + ww > ML + textW) {
          x = ML + indent;
          y += lh;
          checkPage(lh);
          lineStartY = y;
        }
        doc.text(word, x, y);
        x += ww;
      }
    }
    y = Math.max(y, lineStartY) + lh;
    checkPage(lh);
  }

  function clausula(text) {
    const idx = text.indexOf(': ');
    if (idx > 0 && idx < 80 && text[idx - 1].match(/[a-zA-Z0-9]/)) {
      const titulo = text.slice(0, idx + 1);
      const cuerpo = text.slice(idx + 2);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(10);
      let x = ML + indent;
      const cleanTitle = titulo.replace(/^\*\*|\*\*$/g, '');
      const words = cleanTitle.split(' ');
      for (let i = 0; i < words.length; i++) {
        const word = words[i] + (i < words.length - 1 ? ' ' : '');
        const ww = doc.getTextWidth(word);
        if (x + ww > ML + textW) {
          x = ML + indent;
          y += lh;
          checkPage(lh);
        }
        doc.text(word, x, y);
        x += ww;
      }
      y += lh;
      checkPage(lh);
      richText(cuerpo);
    } else {
      richText(text);
    }
    y += 1.5;
    checkPage(lh);
  }

  // footer
  const footerY = PH - 12;
  function renderFooter() {
    const totalPages = doc.internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('Helvetica', 'normal');
      doc.text(`Pagina ${i}/${totalPages}`, PW / 2, footerY, { align: 'center' });
    }
    doc.setPage(totalPages);
  }

  // --- TITLE ---
  doc.setFontSize(16);
  writeCentered('CONTRATO DE ARRENDAMIENTO', true, 16);
  writeCentered('DE VIVIENDA URBANA', false, 11);
  y += 2;
  doc.setDrawColor(150, 150, 150);
  doc.line(ML, y, PW - MR, y);
  y += 5;

  for (const clause of CLAUSULAS) {
    clausula(clause(d));
  }

  // --- SIGNATURES (must stay together on one page) ---
  const coCount = (data.co_arrendatarios || []).length;
  const sigBlockH = 90 + coCount * 30;
  if (y + sigBlockH > PH - MB) {
    doc.addPage();
    y = MT;
  }
  y += 10;
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('El arrendador:', ML + indent, y);
  y += 16;
  doc.setFont('Helvetica', 'normal');
  doc.line(ML + indent, y, ML + indent + 60, y);
  y += 6;
  doc.text(d.propietario_nombre, ML + indent, y);
  y += 6;
  doc.text(`C.C. ${d.propietario_cedula} expedida en ${d.propietario_expedida}`, ML + indent, y);
  y += 12;
  doc.setFont('Helvetica', 'bold');
  doc.text('El arrendatario:', ML + indent, y);
  y += 16;
  doc.setFont('Helvetica', 'normal');
  doc.line(ML + indent, y, ML + indent + 60, y);
  y += 6;
  doc.text(d.arrendatario_nombre, ML + indent, y);
  y += 6;
  doc.text(`C.C. ${d.arrendatario_cedula} expedida en ${d.arrendatario_expedida}`, ML + indent, y);

  for (const co of (data.co_arrendatarios || [])) {
    if (!co.nombre) continue;
    y += 12;
    doc.setFont('Helvetica', 'bold');
    doc.text('Co-arrendatario:', ML + indent, y);
    y += 16;
    doc.setFont('Helvetica', 'normal');
    doc.line(ML + indent, y, ML + indent + 60, y);
    y += 6;
    doc.text(co.nombre, ML + indent, y);
    y += 5;
    doc.text(`C.C. ${co.cedula || ''} expedida en ${co.expedida || 'Soledad'}`, ML + indent, y);
  }

  renderFooter();

  const nameParts = [data.arrendatario_nombre.replace(/[^a-zA-Z0-9]/g, '_')];
  for (const co of (data.co_arrendatarios || [])) {
    if (co.nombre) nameParts.push(co.nombre.replace(/[^a-zA-Z0-9]/g, '_'));
  }
  const filename = `Contrato_apto_${data.apto.replace(/[^a-zA-Z0-9]/g, '_')}_${nameParts.join('_y_')}.pdf`;
  return { doc, filename, data: doc.output('datauristring'), blob: doc.output('blob') };
}
