export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount || 0);
}

// Gases del Caribe payment links must point to the contract, not to the
// monthly receipt/coupon QR. The contract page lets the tenant see the
// current debt and historical balance without the administrator session.
export function gasContractPaymentUrl(contract) {
  const code = String(contract || '').trim();
  return code ? `https://portal.gascaribe.com/payments/contract/${encodeURIComponent(code)}` : '';
}

export function servicePaymentUrl(apartment, service) {
  if (service === 'electricity') {
    const nic = String(apartment?.electricityPaymentCode || apartment?.nic || '').replace(/\D/g, '');
    return nic ? `https://portal.air-e.com/Pagar#/User/${encodeURIComponent(nic)}/NUMEROCONTRATO` : 'https://portal.air-e.com/Pagar#/List';
  }
  if (service === 'gas') return gasContractPaymentUrl(apartment?.gasPaymentCode);
  if (service === 'water') return 'https://portal.aaa.com.co/pagos';
  const field = 'waterPaymentUrl';
  const value = String(apartment?.[field] || '').trim();
  if (!/^https?:\/\//i.test(value)) return '';
  return value;
}

export function parsePeriodDate(periodStr) {
  if (!periodStr) return new Date();
  const str = String(periodStr).trim();
  if (/^\d{6}$/.test(str)) {
    const y = parseInt(str.slice(0, 4), 10);
    const m = parseInt(str.slice(4, 6), 10);
    return new Date(y, m - 1, 1);
  }
  if (/^\d{4}-\d{2}/.test(str)) {
    const parts = str.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  return new Date();
}

export function formatPeriodLabel(dateObj) {
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${months[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
}

export function prevMonthDate(dateObj, count = 1) {
  return new Date(dateObj.getFullYear(), dateObj.getMonth() - count, 1);
}

export function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  if (typeof dateStr === 'string') {
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

export function resolveDueDate(rec) {
  if (rec?.vencimiento) return rec.vencimiento;
  if (rec?.dt_Vencimiento) return rec.dt_Vencimiento;
  if (rec?.expirationDate) return rec.expirationDate;
  if (Array.isArray(rec?.facturas) && rec.facturas.length > 0) {
    for (const f of rec.facturas) {
      if (f.vencimiento) return f.vencimiento;
      if (f.dt_Vencimiento) return f.dt_Vencimiento;
      if (f.expirationDate) return f.expirationDate;
    }
  }
  if (rec?.periodo && /^\d{4}-\d{2}-\d{2}/.test(rec.periodo)) {
    return rec.periodo;
  }
  return null;
}

export function resolveSuspensionDate(rec, svcKey) {
  if (rec?.fechaSuspension) return rec.fechaSuspension;
  if (rec?.dt_Suspension) return rec.dt_Suspension;
  if (rec?.suspensionDate) return rec.suspensionDate;
  if (Array.isArray(rec?.facturas) && rec.facturas.length > 0) {
    for (const f of rec.facturas) {
      if (f.fechaSuspension) return f.fechaSuspension;
      if (f.dt_Suspension) return f.dt_Suspension;
      if (f.suspensionDate) return f.suspensionDate;
    }
  }
  const venc = resolveDueDate(rec);
  if (venc) {
    const d = parseDateSafe(venc);
    if (d && !isNaN(d.getTime())) {
      if (svcKey === 'electricity') d.setDate(d.getDate() + 3);
      else if (svcKey === 'water') d.setDate(d.getDate() + 2);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  return null;
}

export function buildRecentInvoicesHistory(record, serviceKey, apartment) {
  const labels = ['Factura actual', 'Mes pasado', 'Hace 2 meses'];
  const facturas = Array.isArray(record?.facturas) ? [...record.facturas] : [];

  facturas.sort((a, b) => {
    const da = parsePeriodDate(a.periodo || a.vencimiento);
    const db = parsePeriodDate(b.periodo || b.vencimiento);
    return db.getTime() - da.getTime();
  });

  const baseDate = parsePeriodDate(facturas[0]?.periodo || record?.periodo || record?.checkedAt);

  const result = [];
  for (let i = 0; i < 3; i++) {
    const label = labels[i];
    const targetDate = prevMonthDate(baseDate, i);
    const periodLabel = formatPeriodLabel(targetDate);
    const inv = facturas[i] || null;

    if (inv) {
      const isPaid = /PAGAD[AO]|AL_DIA/i.test(String(inv.estado || '')) || inv.deudaTotalCOP === 0;
      const valor = inv.valorCOP ?? inv.facturaValorCOP ?? null;
      const saldo = isPaid ? 0 : (inv.deudaTotalCOP ?? valor ?? 0);
      const invVenc = resolveDueDate(inv);
      const invSusp = resolveSuspensionDate(inv, serviceKey) || (invVenc ? resolveSuspensionDate({ vencimiento: invVenc }, serviceKey) : null);
      result.push({
        label,
        periodo: periodLabel,
        valorCOP: valor,
        saldoCOP: saldo,
        estado: isPaid ? 'paid' : 'pending',
        estadoTexto: isPaid ? 'Pagada' : (saldo > 0 ? 'Debe saldo' : 'Al día'),
        factura: inv.factura || inv.numero || null,
        vencimiento: invVenc,
        fechaSuspension: invSusp,
      });
    } else if (i === 0) {
      const isPaid = record?.status === 'paid' || (record?.deudaTotalCOP === 0 && record?.deudaCOP === 0);
      const valor = record?.deudaMesCOP ?? record?.facturaValorCOP ?? record?.deudaCOP ?? null;
      const saldo = isPaid ? 0 : (record?.deudaCOP ?? record?.deudaTotalCOP ?? 0);
      const mainVenc = resolveDueDate(record);
      const mainSusp = resolveSuspensionDate(record, serviceKey);
      result.push({
        label,
        periodo: periodLabel,
        valorCOP: valor,
        saldoCOP: saldo,
        estado: isPaid ? 'paid' : 'pending',
        estadoTexto: isPaid ? 'Pagada' : (saldo > 0 ? 'Debe saldo' : 'Al día'),
        factura: record?.factura || null,
        vencimiento: mainVenc,
        fechaSuspension: mainSusp,
      });
    } else if (i === 1) {
      const totalDebt = record?.deudaTotalCOP ?? record?.deudaCOP ?? 0;
      const monthDebt = record?.deudaMesCOP ?? record?.facturaValorCOP ?? 0;
      const carriedDebt = Math.max(0, totalDebt - monthDebt);
      const isPaid = carriedDebt === 0;
      result.push({
        label,
        periodo: periodLabel,
        valorCOP: null,
        saldoCOP: carriedDebt,
        estado: isPaid ? 'paid' : 'pending',
        estadoTexto: isPaid ? 'Pagada' : 'Debe saldo anterior',
        factura: null,
        vencimiento: null,
      });
    } else {
      result.push({
        label,
        periodo: periodLabel,
        valorCOP: null,
        saldoCOP: 0,
        estado: 'paid',
        estadoTexto: 'Pagada',
        factura: null,
        vencimiento: null,
      });
    }
  }

  return result;
}

export function getSuspensionAlert(record, serviceKey) {
  if (!record) return null;
  const isPaid = record.status === 'paid' || (Number(record.deudaCOP || 0) === 0 && Number(record.deudaTotalCOP || 0) === 0);
  if (isPaid) return null;

  const suspStr = resolveSuspensionDate(record, serviceKey);
  const vencStr = resolveDueDate(record);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (suspStr) {
    const suspDate = parseDateSafe(suspStr);
    if (suspDate) {
      const diffDays = Math.ceil((suspDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) {
        return {
          level: 'critical',
          isSuspended: true,
          date: suspDate,
          text: `⚠️ Corte/Suspensión cumplida (${formatShortDate(suspStr)}). ¡Riesgo inminente de suspensión!`,
        };
      }
      if (diffDays <= 4) {
        return {
          level: 'urgent',
          isSuspended: false,
          date: suspDate,
          text: `⚠️ Corte programado: ${formatShortDate(suspStr)} (en ${diffDays} día${diffDays === 1 ? '' : 's'}). ¡Pagar urgente!`,
        };
      }
      return {
        level: 'warning',
        isSuspended: false,
        date: suspDate,
        text: `Fecha límite corte: ${formatShortDate(suspStr)}`,
      };
    }
  }

  if (vencStr) {
    const vencDate = parseDateSafe(vencStr);
    if (vencDate) {
      const diffDays = Math.ceil((vencDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) {
        return {
          level: 'overdue',
          isSuspended: false,
          date: vencDate,
          text: `Factura vencida el ${formatShortDate(vencStr)}. Pendiente de pago.`,
        };
      }
    }
  }

  return null;
}

export function isUtilitySuspended(record, serviceKey) {
  const alert = getSuspensionAlert(record, serviceKey);
  return alert && (alert.level === 'critical' || alert.level === 'urgent');
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = parseDateSafe(dateStr);
  if (!d) return '';
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = parseDateSafe(dateStr);
  if (!d) return '';
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function daysBetween(start, end) {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  return Math.max(0, Math.floor((e - s) / (1000 * 60 * 60 * 24)));
}

export function monthsBetween(start, end) {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
}

export function getCurrentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthName(monthNum) {
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return months[monthNum - 1] || '';
}

export function getPeriodLabel(period) {
  const [y, m] = period.split('-');
  return `${getMonthName(Number(m))} ${y}`;
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export function daysUntil(paymentDay) {
  const now = new Date();
  const currentDay = now.getDate();
  const target = new Date(now.getFullYear(), now.getMonth(), paymentDay);
  if (currentDay > paymentDay) target.setMonth(target.getMonth() + 1);
  const daysLeft = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  return { daysLeft, targetDate: target };
}

export function periodToDate(period) {
  const [y, m] = period.split('-');
  return new Date(Number(y), Number(m) - 1, 1);
}

export function nextPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function getAllPeriodsFrom(startPeriod) {
  const periods = [];
  let current = startPeriod;
  const now = getCurrentPeriod();
  while (current <= now) {
    periods.push(current);
    current = nextPeriod(current);
  }
  return periods;
}


export function formatRelativeDueDate(paymentDay) {
  const now = new Date();
  const currentDay = now.getDate();
  const target = new Date(now.getFullYear(), now.getMonth(), paymentDay);
  const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));

  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  if (diffDays === 0) {
    return `Vence hoy ${target.getDate()} de ${target.toLocaleString('es-CO', { month: 'long' })}`;
  }
  if (diffDays === -1) {
    return `Venció ayer ${target.getDate()} de ${target.toLocaleString('es-CO', { month: 'long' })}`;
  }
  if (diffDays === 1) {
    return `Vencerá mañana ${target.getDate()} de ${target.toLocaleString('es-CO', { month: 'long' })}`;
  }
  if (diffDays < 0 && diffDays >= -7) {
    return `Venció hace ${Math.abs(diffDays)} días (${target.getDate()} ${target.toLocaleString('es-CO', { month: 'short' })})`;
  }
  if (diffDays > 0 && diffDays <= 7) {
    return `Vence en ${diffDays} días (${target.getDate()} ${target.toLocaleString('es-CO', { month: 'short' })})`;
  }
  if (diffDays < 0) {
    return `Venció el ${target.toLocaleString('es-CO', { day: 'numeric', month: 'long' })}`;
  }
  return `Vence el ${target.toLocaleString('es-CO', { day: 'numeric', month: 'long' })}`;
}

export function openEzvizApp() {
  try {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const isAndroid = /android/i.test(userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);

    if (isAndroid) {
      // Android Chrome Intent: Lanza com.ezviz directamente y si no está instalada abre Google Play Store
      window.location.href = 'intent://#Intent;package=com.ezviz;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.ezviz;end;';
    } else if (isIOS) {
      window.location.href = 'ezviz://';
      setTimeout(() => {
        window.location.href = 'https://apps.apple.com/app/ezviz/id886948564';
      }, 2000);
    } else {
      // Escritorio / PC
      window.open('https://play.google.com/store/apps/details?id=com.ezviz', '_blank');
    }
  } catch (err) {
    console.warn('[EzvizLauncher] Error:', err.message);
    window.open('https://play.google.com/store/apps/details?id=com.ezviz', '_blank');
  }
}

export function cleanFinancingConcept(str) {
  if (!str) return '';
  return String(str)
    .replace(/Suspensi[\uFFFD\?]?n\s*acu\b/gi, 'Suspensión acueducto')
    .replace(/Suspensi[\uFFFD\?]?n\b/gi, 'Suspensión')
    .replace(/Reinstalaci[\uFFFD\?]?n\s*acued\b/gi, 'Reinstalación acueducto')
    .replace(/Reinstalaci[\uFFFD\?]?n\b/gi, 'Reinstalación')
    .replace(/RECONEXION\s+CENTRO\s+DE\s+MEDICI[\uFFFD\?]?N/gi, 'Reconexión centro de medición')
    .replace(/CARGO\s+POR\s+CONEXI[\uFFFD\?]?N/gi, 'Cargo por conexión')
    .replace(/REVISION\s+PERIODICA/gi, 'Revisión periódica')
    .replace(/CUOTA\s+IVA\s*-\s*BIENES\s+Y\s+SERVICIOS/gi, 'Cuota IVA - Bienes y servicios')
    .replace(/Acueducto\s+cargo\s+x\s+consumo\s+CMI/gi, 'Acueducto cargo por consumo')
    .replace(/Barrido\s+y\s+limpieza/gi, 'Aseo (Barrido y limpieza)')
    .replace(/[\uFFFD]/g, 'ó')
    .replace(/\s+/g, ' ')
    .trim();
}
