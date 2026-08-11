/*
 * Local portal runner for the Android worker.
 *
 * This file executes inside Laujim's own Android WebView. It deliberately
 * uses the authenticated page context (cookies, local storage and the
 * portal's approved API requests) instead of a remote browser or a captcha
 * bypass. If a portal asks for login or a human verification, the runner
 * reports needs_login/needs_verification and the native app can show it.
 */
(function () {
  'use strict';

  const AIR_E_ENDPOINT = 'https://portal.air-e.com/DesktopModules/GatewayOficinaVirtual.Maestro.MisFacturas/API/Documento/Get';
  const GAS_API = 'https://pagosweb-production-api.innovacion-gascaribe.com';

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function clean(value) {
    return String(value == null ? '' : value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function digits(value) { return String(value == null ? '' : value).replace(/\D/g, ''); }

  function apartmentNumber(value) {
    const text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ' ');
    const floorUnit = text.match(/\b([1-5])\s*[-/]\s*(\d{1,2})\b/);
    if (floorUnit) return `${floorUnit[1]}${String(floorUnit[2]).padStart(2, '0')}`;
    const explicit = text.match(/(?:ap|apto|apartamento|unidad|unit|inmueble|casa)\s*#?\s*([1-9]\d{2})\b/i);
    if (explicit) return explicit[1];
    const exact = text.trim().match(/^([1-9]\d{2})$/);
    if (exact) return exact[1];
    const any = text.match(/\b([1-9]\d{2})\b/);
    return any ? any[1] : null;
  }

  function visible(element) {
    if (!element || element.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && !!element.getClientRects().length;
  }

  function loginState() {
    const body = clean(document.body && document.body.innerText);
    const password = Array.from(document.querySelectorAll('input[type="password"], input[name*="password" i], input[id*="password" i]')).find(visible);
    const challenge = Array.from(document.querySelectorAll(
      '.cf-turnstile, iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], [id*="captcha" i]'
    )).find(visible);
    const hasChallengeText = /captcha|turnstile|no soy un robot|verificacion en dos pasos|codigo de verificacion/.test(body);
    return {
      password: !!password,
      challenge: !!challenge || hasChallengeText,
      url: location.href,
      title: document.title || '',
      body: body.slice(0, 1200),
    };
  }

  function field(value, names, depth) {
    if (value == null || depth > 6) return undefined;
    if (typeof value !== 'object') return undefined;
    const wanted = (names || []).map(name => clean(name).replace(/ /g, ''));
    for (const [key, child] of Object.entries(value)) {
      const keyName = clean(key).replace(/ /g, '');
      if (wanted.includes(keyName) && child !== null && child !== undefined && child !== '') return child;
    }
    for (const child of Object.values(value)) {
      const found = field(child, names, (depth || 0) + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function topLevelField(value, names) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const entries = Object.entries(value);
    for (const name of names || []) {
      const wanted = clean(name).replace(/ /g, '');
      const match = entries.find(([key, child]) => clean(key).replace(/ /g, '') === wanted && child !== null && child !== undefined && child !== '');
      if (match) return match[1];
    }
    return field(value, names);
  }

  function list(value, keys, depth, seen) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object' || (depth || 0) > 6) return [];
    const visited = seen || new Set();
    if (visited.has(value)) return [];
    visited.add(value);
    for (const key of keys || []) {
      if (Array.isArray(value[key])) return value[key];
      const nested = list(value[key], keys, (depth || 0) + 1, visited);
      if (nested.length) return nested;
    }
    for (const key of ['data', 'result', 'response', 'payload', 'content']) {
      const nested = list(value[key], keys, (depth || 0) + 1, visited);
      if (nested.length) return nested;
    }
    for (const child of Object.values(value)) {
      const nested = list(child, keys, (depth || 0) + 1, visited);
      if (nested.length && nested.every(item => item && typeof item === 'object' && !Array.isArray(item))) return nested;
    }
    return [];
  }

  function allStrings(value, key, depth, output) {
    const result = output || [];
    if (value == null || (depth || 0) > 5) return result;
    if (['string', 'number'].includes(typeof value)) {
      const text = String(value).trim();
      if (text && (!key || /id|code|number|numero|polic|poliza|contract|contrato|subscription|account|cuenta|alias|name|nombre|apto|apartamento|unit|unidad|property|inmueble|cliente/i.test(key))) result.push(text);
      return result;
    }
    if (Array.isArray(value)) {
      value.forEach(child => allStrings(child, key, (depth || 0) + 1, result));
      return result;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([childKey, child]) => allStrings(child, childKey, (depth || 0) + 1, result));
    }
    return result;
  }

  function targetMatchScore(target, record, provider) {
    const values = allStrings(record).map(value => ({ raw: value, normalized: clean(value), digits: digits(value) }));
    const code = provider === 'air-e' ? target.electricityPaymentCode : provider === 'water' ? target.waterPaymentCode : target.gasPaymentCode;
    const codeDigits = digits(code);
    const number = apartmentNumber(target.name);
    const name = clean(target.name);
    const codeMatch = !!codeDigits && values.some(value => value.digits === codeDigits);
    const numberMatch = !!number && values.some(value => apartmentNumber(value.raw) === number);
    const nameMatch = !!name && values.some(value => value.normalized === name);

    // The portal's apartment label is authoritative. Payment codes can be
    // stale or reassigned; using them first caused AP 401 to be stored under
    // apartment 203 when both records shared an old policy number.
    if (nameMatch) return 300;
    if (numberMatch) return 200;
    if (codeMatch) return 100;
    return 0;
  }

  function bestTargetMatch(apartments, record, provider, used) {
    let best = null;
    let bestScore = 0;
    for (const target of apartments || []) {
      if (used && used.has(String(target.id || target.name))) continue;
      const score = targetMatchScore(target, record, provider);
      if (score > bestScore) {
        best = target;
        bestScore = score;
      }
    }
    return best;
  }

  function parseAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    if (value == null || value === '') return null;
    let raw = String(value).replace(/[^0-9,.-]/g, '').replace(/-/g, '');
    if (!raw) return null;
    if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.');
    else if (raw.includes(',')) {
      const parts = raw.split(',');
      raw = parts[parts.length - 1].length === 2 ? `${parts.slice(0, -1).join('')}.${parts[parts.length - 1]}` : parts.join('');
    } else if (raw.includes('.')) raw = raw.replace(/\./g, '');
    const amount = Number(raw);
    return Number.isFinite(amount) ? Math.round(amount) : null;
  }

  function statusFrom(amount, value) {
    const status = clean(value);
    if (amount !== null && amount > 0) return 'pending';
    if (amount === 0 || /paid|pagad|al dia|up to date|sin deuda|cancelad|sin_deuda/.test(status)) return 'paid';
    if (/pending|pendiente|overdue|vencid|mora|in_debt/.test(status)) return 'pending';
    return 'unknown';
  }

  function resultBase(provider, service, target, extra) {
    const checkedAt = new Date().toISOString();
    return Object.assign({
      provider,
      service,
      apartmentId: target.id == null ? null : target.id,
      apartment: target.name,
      status: 'unknown',
      deudaCOP: null,
      deudaTotalCOP: null,
      deudaLabel: 'Deuda Total',
      numFacturas: null,
      factura: null,
      periodo: null,
      error: null,
      checkedAt,
      scrapedAt: checkedAt,
    }, extra || {});
  }

  function needsLogin(provider, message) {
    return { state: 'needs_login', provider, message: message || 'Inicia sesión en el portal desde la app Laujim.', results: [] };
  }

  async function json(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const requestOptions = Object.assign({ credentials: 'include', headers: { Accept: 'application/json' } }, options || {});
      // Gascaribe's API accepts the bearer token but does not enable
      // Access-Control-Allow-Credentials. Sending WebView cookies to that
      // cross-origin API makes Chromium reject the response as "Failed to
      // fetch" before JavaScript can inspect its HTTP status.
      if (!Object.prototype.hasOwnProperty.call(options || {}, 'credentials')) {
        try {
          if (new URL(url, location.href).origin !== location.origin) requestOptions.credentials = 'omit';
        } catch {}
      }
      const response = await fetch(url, Object.assign(requestOptions, { signal: controller.signal }));
      const body = await response.text();
      let payload = null;
      try { payload = JSON.parse(body); } catch {}
      return { status: response.status, ok: response.ok, payload, body };
    } finally { clearTimeout(timer); }
  }

  function authorizationVariants(token) {
    const value = String(token || '').trim().replace(/^['"]|['"]$/g, '');
    if (!value) return [];
    const bare = value.replace(/^(?:Bearer|Token)\s+/i, '').trim();
    return [...new Set([value, bare, `Bearer ${bare}`, `Token ${bare}`].filter(Boolean))];
  }

  async function jsonWithAuthFallback(url, token, options) {
    const base = options || {};
    const baseHeaders = Object.assign({}, base.headers || {});
    let response = await json(url, Object.assign({}, base, { headers: baseHeaders }));
    if (![401, 403].includes(response.status)) return response;
    for (const authorization of authorizationVariants(token)) {
      response = await json(url, Object.assign({}, base, {
        headers: Object.assign({}, baseHeaders, { Authorization: authorization }),
      }));
      if (![401, 403].includes(response.status)) break;
    }
    return response;
  }

  function responseDetail(response) {
    try {
      const payload = response && response.body ? JSON.parse(response.body) : null;
      const detail = field(payload, ['message', 'error', 'detail', 'title', 'reason']);
      return detail ? String(detail).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    } catch {
      return '';
    }
  }

  function storedToken() {
    const nativeToken = String(window.__LaujimNativeAuthorization || '').trim();
    if (nativeToken) return nativeToken;
    const candidates = [];
    for (const store of [localStorage, typeof sessionStorage !== 'undefined' ? sessionStorage : null]) {
      if (!store) continue;
      try {
        for (let index = 0; index < store.length; index += 1) {
          const key = store.key(index);
          const value = store.getItem(key);
          if (!value) continue;
          if (/token|access|auth|jwt/i.test(key || '') || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
            candidates.push(value);
            continue;
          }
          try {
            const parsed = JSON.parse(value);
            const nested = field(parsed, ['accessToken', 'access_token', 'token', 'authorization', 'jwt']);
            if (nested) candidates.push(String(nested));
          } catch {}
        }
      } catch {
      }
    }
    for (const raw of candidates) {
      try {
        const parsed = JSON.parse(raw);
        const token = field(parsed, ['accessToken', 'access_token', 'token', 'authorization', 'jwt']);
        if (token) return String(token);
      } catch {}
      if (raw.length > 20 && !raw.includes('{') && !raw.includes('[')) return raw;
    }
    return '';
  }

  async function runAirE(config) {
    const state = loginState();
    if (state.password) return needsLogin('air-e', 'Air-e solicita iniciar sesión. Abre el portal desde Laujim, inicia sesión y vuelve a ejecutar.');
    await wait(1800);
    let contract = null;
    for (let attempt = 0; attempt < 12 && !contract; attempt += 1) {
      const resources = performance.getEntriesByType('resource') || [];
      const found = resources.map(item => String(item.name || '').match(/cd_Contrato=([0-9a-f-]{36})/i)).find(Boolean);
      contract = found && found[1];
      if (!contract) await wait(1000);
    }
    if (!contract) return { state: 'error', provider: 'air-e', message: 'Air-e no mostró el contrato autenticado. Abre Listado de Facturas en el portal y vuelve a ejecutar.', results: [] };
    const response = await json(`${AIR_E_ENDPOINT}?cd_Contrato=${encodeURIComponent(contract)}&pageIndex=1&pageSize=1000`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!response.ok) return needsLogin('air-e', `Air-e rechazó la consulta (HTTP ${response.status}). Inicia sesión nuevamente desde la app.`);
    const items = Array.isArray(response.payload && response.payload.items) ? response.payload.items : list(response.payload, ['items', 'documents', 'invoices']);
    const grouped = {};
    items.forEach(invoice => {
      const nic = String(invoice && invoice.cd_Poliza || '').trim();
      if (!nic || /PAGAD[AO]/.test(String(invoice.cd_EstadosPagoDocumento || '').toUpperCase())) return;
      const total = parseAmount(field(invoice, ['amt_DeudaTotal', 'deudaTotal', 'DeudaTotal']));
      const balance = parseAmount(field(invoice, ['amt_SaldoConsulta', 'saldoConsulta', 'SaldoConsulta']));
      const group = grouped[nic] || { total: [], balance: [] };
      if (total !== null) group.total.push(total); else if (balance !== null) group.balance.push(balance);
      grouped[nic] = group;
    });
    const results = (config.apartments || []).filter(target => target.electricityPaymentCode).map(target => {
      const nic = String(target.electricityPaymentCode).replace(/\D/g, '');
      const group = grouped[nic] || { total: [], balance: [] };
      const debt = group.total.length ? Math.max.apply(Math, group.total) : group.balance.reduce((sum, value) => sum + value, 0);
      return resultBase('Air-e', 'electricity', target, {
        nic,
        status: debt > 0 ? 'pending' : 'paid',
        deudaCOP: debt,
        deudaTotalCOP: debt,
        deudaText: debt > 0 ? `Deuda Total del NIC: $${debt.toLocaleString('es-CO')}.` : 'Deuda Total del NIC: $0 (al día).',
      });
    });
    return { state: 'ok', provider: 'air-e', results };
  }

  async function runWater(config) {
    const state = loginState();
    if (state.password) return needsLogin('water', 'Triple A solicita iniciar sesión. Abre el portal desde Laujim, inicia sesión y vuelve a ejecutar.');
    if (state.challenge) return { state: 'needs_verification', provider: 'water', message: 'Triple A muestra una verificación. Completa la pantalla visible y vuelve a ejecutar.', results: [] };
    const token = storedToken();
    const response = await jsonWithAuthFallback('/bff/subscriptions', token, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'x-app-version': 'unknown' },
    });
    if (response.status === 401 || response.status === 403) return needsLogin('water', `Triple A rechazó la sesión (HTTP ${response.status}). Inicia sesión desde la app.`);
    if (!response.ok) return { state: 'error', provider: 'water', message: `Triple A rechazó la consulta (HTTP ${response.status}).`, results: [] };
    const subscriptions = list(response.payload, ['subscriptions', 'policies', 'items']);
    if (!subscriptions.length) return { state: 'error', provider: 'water', message: 'Triple A aceptó la sesión, pero no devolvió pólizas o suscripciones.', results: [] };
    const results = [];
    const used = new Set();
    for (const subscription of subscriptions) {
      const target = bestTargetMatch(config.apartments || [], subscription, 'water', used);
      if (!target) continue;
      used.add(String(target.id || target.name));
      const rawAmount = field(subscription, ['pendingValue', 'pendingAmount', 'debt', 'deudaTotal', 'totalDebt', 'amountDue', 'totalDue', 'balanceDue', 'saldoTotal', 'saldoPendiente', 'total', 'amount', 'balance', 'saldo']);
      const amount = parseAmount(rawAmount);
      const rawStatus = field(subscription, ['status', 'state', 'paymentStatus']);
      const code = field(subscription, ['subscriptionExternalId', 'externalId', 'subscriptionId', 'policyNumber', 'poliza', 'policy', 'id']);
      results.push(resultBase('Triple A', 'water', target, {
        waterPaymentCode: String(code || target.waterPaymentCode || '').trim() || null,
        status: statusFrom(amount, rawStatus || field(subscription, ['isPending', 'pending', 'pendiente'])),
        deudaCOP: amount === null && /pending|pendiente|vencid|mora/i.test(String(rawStatus || '')) ? null : (amount === null ? 0 : Math.max(0, amount)),
        deudaTotalCOP: amount === null && /pending|pendiente|vencid|mora/i.test(String(rawStatus || '')) ? null : (amount === null ? 0 : Math.max(0, amount)),
        factura: field(subscription, ['invoiceNumber', 'invoiceId', 'factura']) || null,
        periodo: field(subscription, ['invoiceDate', 'billingPeriod', 'periodo']) || null,
      }));
    }
    if (!results.length) return { state: 'error', provider: 'water', message: 'Triple A devolvió pólizas, pero ninguna coincidió con los apartamentos configurados.', results: [] };
    return { state: 'ok', provider: 'water', results };
  }

  async function runGas(config) {
    const state = loginState();
    if (state.password) return needsLogin('gas', 'Gases del Caribe solicita iniciar sesión. Abre el portal desde Laujim, inicia sesión y vuelve a ejecutar.');
    if (state.challenge) return { state: 'needs_verification', provider: 'gas', message: 'Gases del Caribe muestra una verificación. Completa la pantalla visible y vuelve a ejecutar.', results: [] };
    const token = storedToken();
    const response = await jsonWithAuthFallback(`${GAS_API}/contracts`, token, { credentials: 'omit' });
    if (response.status === 401 || response.status === 403) return needsLogin('gas', `Gases del Caribe rechazó la sesión (HTTP ${response.status}). Inicia sesión desde la app.`);
    if (!response.ok) return { state: 'error', provider: 'gas', message: `Gases del Caribe rechazó la consulta (HTTP ${response.status}).`, results: [] };
    const payloadToken = field(response.payload, ['token', 'appToken', 'accessToken', 'authorization']);
    const auth = String(payloadToken || token || '').trim();
    const contracts = list(response.payload, ['contracts', 'items']);
    if (!contracts.length) return { state: 'error', provider: 'gas', message: 'Gases del Caribe aceptó la sesión, pero no devolvió contratos.', results: [] };
    const results = [];
    const used = new Set();
    let invoiceFailures = 0;
    let matchedContracts = 0;
    let unmatchedContracts = 0;
    let missingContractIds = 0;
    const invoiceFailureDetails = [];
    for (const contract of contracts) {
      const target = bestTargetMatch(config.apartments || [], contract, 'gas', used);
      if (!target) {
        unmatchedContracts += 1;
        continue;
      }
      matchedContracts += 1;
      // Gascaribe's own frontend calls /invoices/{contract.id}. Prefer the
      // top-level id before human-facing contract numbers or nested ids.
      const contractId = topLevelField(contract, ['id', 'contractId', 'contractNumber', 'number']);
      if (!contractId) {
        missingContractIds += 1;
        continue;
      }
      const invoiceResponse = await jsonWithAuthFallback(`${GAS_API}/invoices/${encodeURIComponent(contractId)}`, auth, { credentials: 'omit' });
      if (!invoiceResponse.ok) {
        invoiceFailures += 1;
        const detail = responseDetail(invoiceResponse);
        invoiceFailureDetails.push(`${invoiceResponse.status ? `HTTP ${invoiceResponse.status}` : 'sin respuesta del endpoint de facturas'}${detail ? `: ${detail}` : ''}`);
        continue;
      }
      const invoices = list(invoiceResponse.payload, ['invoices', 'items']);
      const unpaid = [];
      invoices.forEach(invoice => {
        const amount = parseAmount(field(invoice, ['pendingValue', 'pendingAmount', 'couponValue', 'amountDue', 'totalToPay', 'totalDebt', 'deudaTotal', 'invoiceValue', 'balanceDue', 'balance', 'saldo', 'debt', 'total', 'amount', 'value']));
        const paid = field(invoice, ['isPaid', 'paid', 'pagada', 'status']);
        const pending = field(invoice, ['isPending', 'pending', 'pendiente', 'status']);
        const isPaid = paid === true || /true|paid|pagad|cancelad/i.test(String(paid || ''));
        const isPending = pending === true || /true|pending|pendiente|vencid|overdue/i.test(String(pending || ''));
        if (!isPaid && (isPending || (amount !== null && amount > 0))) unpaid.push({ invoice, amount });
      });
      const amounts = unpaid.map(item => item.amount).filter(value => value !== null);
      const debt = amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : (unpaid.length ? null : 0);
      used.add(String(target.id || target.name));
      results.push(resultBase('Gases del Caribe', 'gas', target, {
        gasPaymentCode: String(contractId),
        status: debt === null || debt > 0 ? 'pending' : 'paid',
        deudaCOP: debt,
        deudaTotalCOP: debt,
        numFacturas: unpaid.length,
        factura: field(unpaid[0] && unpaid[0].invoice, ['id', 'invoiceNumber', 'factura']) || null,
        periodo: field(unpaid[0] && unpaid[0].invoice, ['expirationDate', 'dueDate', 'fechaVencimiento']) || null,
      }));
    }
    if (!results.length && matchedContracts > 0 && (invoiceFailures > 0 || missingContractIds > 0)) {
      const details = [...new Set(invoiceFailureDetails)].slice(0, 3).join(', ');
      const suffix = details ? ` Detalle: ${details}.` : '';
      return {
        state: 'error',
        provider: 'gas',
        message: `Gases del Caribe asociÃ³ ${matchedContracts} contrato(s) con apartamentos, pero no pudo consultar sus facturas (${invoiceFailures} fallo(s), ${missingContractIds} sin identificador).${suffix}`,
        results: [],
      };
    }
    if (!results.length && matchedContracts === 0) {
      return {
        state: 'error',
        provider: 'gas',
        message: `Gases del Caribe devolviÃ³ ${contracts.length} contrato(s), pero ninguno coincidiÃ³ con los apartamentos configurados (${unmatchedContracts} sin asociar).`,
        results: [],
      };
    }
    if (!results.length) {
      const reason = invoiceFailures ? ` No se pudieron consultar ${invoiceFailures} contrato(s).` : '';
      return { state: 'error', provider: 'gas', message: `Gases del Caribe devolvió contratos, pero ninguno coincidió con los apartamentos configurados.${reason}`, results: [] };
    }
    if (invoiceFailures || missingContractIds || unmatchedContracts) {
      return {
        state: 'warning',
        provider: 'gas',
        message: `Gases del Caribe obtuvo ${results.length} apartamento(s); quedaron ${invoiceFailures + missingContractIds} contrato(s) sin factura y ${unmatchedContracts} sin asociar.`,
        results,
      };
    }
    return { state: 'ok', provider: 'gas', results };
  }

  async function run(provider, config) {
    try {
      if (provider === 'air-e') return await runAirE(config || {});
      if (provider === 'water') return await runWater(config || {});
      if (provider === 'gas') return await runGas(config || {});
      return { state: 'error', provider, message: 'Servicio no soportado.', results: [] };
    } catch (error) {
      return { state: 'error', provider, message: error && error.message || 'Error local del portal.', results: [] };
    }
  }

  window.LaujimLocalPortalScraper = { run };
})();
