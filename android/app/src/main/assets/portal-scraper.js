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

  function needsLogin(provider, message, extra) {
    return Object.assign({ state: 'needs_login', provider, message: message || 'Inicia sesión en el portal desde la app Laujim.', results: [] }, extra || {});
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
    } catch (error) {
      return { status: 0, ok: false, payload: null, body: '', error: String(error && error.message || error || 'Failed to fetch') };
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
    const variants = authorizationVariants(token);
    const attempts = variants.length ? variants : [null];
    let response = null;
    for (const authorization of attempts) {
      response = await json(url, Object.assign({}, base, {
        headers: Object.assign({}, baseHeaders, authorization ? { Authorization: authorization } : {}),
      }));
      // A CORS/preflight failure is reported as status 0. Try the remaining
      // token formats because the two provider frontends use different
      // conventions (bare token vs Bearer token).
      if (![0, 401, 403].includes(response.status)) break;
    }
    return response || { status: 0, ok: false, payload: null, body: '', error: 'No se obtuvo respuesta del portal.' };
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

  async function waitForStoredToken(timeoutMs) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    let token = storedToken();
    while (!token && Date.now() < deadline) {
      await wait(500);
      token = storedToken();
    }
    return token;
  }

  function portalAppVersion() {
    try {
      return document.querySelector('meta[name="version-info"]')?.getAttribute('content') || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // The authenticated portals expose the reliable result in their rendered
  // screens.  Their cross-origin APIs are protected by short-lived tokens and
  // anti-forgery values, so the local worker follows the same visible route a
  // user follows after Turnstile has been completed.
  const PORTAL_UI_TIMEOUT_MS = 25_000;
  const PORTAL_PAGE_TIMEOUT_MS = 30_000;

  function uiText(element) {
    if (!element) return '';
    return String(element.innerText || element.textContent || element.getAttribute?.('aria-label') || element.getAttribute?.('title') || '')
      .replace(/\s+/g, ' ').trim();
  }

  function uiBodyText() {
    return String(document.body?.innerText || document.documentElement?.innerText || '');
  }

  function uiLines(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  function findVisibleUiElement(selector, matcher) {
    return Array.from(document.querySelectorAll(selector || '*')).find(element => {
      if (!visible(element)) return false;
      return typeof matcher !== 'function' || matcher(uiText(element), element);
    }) || null;
  }

  async function waitForUi(predicate, timeoutMs) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || PORTAL_UI_TIMEOUT_MS);
    while (Date.now() < deadline) {
      try {
        const value = await predicate();
        if (value) return value;
      } catch {
      }
      await wait(350);
    }
    return null;
  }

  function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function uiAmountAfter(text, label) {
    const source = String(text || '');
    const start = source.toLowerCase().indexOf(String(label || '').toLowerCase());
    if (start < 0) return null;
    const fragment = source.slice(start, start + 180);
    const match = fragment.match(/\$\s*([0-9][0-9.,]*)/);
    return match ? parseAmount(match[1]) : null;
  }

  function uiLineAfter(lines, matcher) {
    const index = lines.findIndex(line => matcher.test(line));
    if (index < 0) return null;
    return lines.slice(index + 1, index + 4).find(Boolean) || null;
  }

  function setUiInputValue(input, value) {
    if (!input) return;
    const next = String(value == null ? '' : value);
    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (descriptor && descriptor.set) descriptor.set.call(input, next);
      else input.value = next;
    } catch {
      input.value = next;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function targetKey(target) {
    return String(target?.id == null ? target?.name || '' : target.id);
  }

  function waterPoliciesOnPage() {
    const records = [];
    const seen = new Set();
    const rows = Array.from(document.querySelectorAll('[role="row"], tr')).filter(visible);
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('[role="gridcell"], td')).filter(visible).map(uiText);
      let name = cells[1] || '';
      let code = digits(cells[2] || '');
      const address = cells[3] || '';
      const rowText = uiText(row);
      if ((!name || code.length < 4) && rowText) {
        const match = rowText.match(/((?:AP|Casa)\s*\d{3})\s*[-–]\s*(\d{4,})/i);
        if (match) {
          name = match[1];
          code = digits(match[2]);
        }
      }
      if (!name || code.length < 4 || seen.has(code)) continue;
      seen.add(code);
      records.push({ name, code, address, status: cells[6] || '' });
    }
    if (!records.length) {
      const paragraphs = Array.from(document.querySelectorAll('p')).filter(visible).map(uiText);
      for (const value of paragraphs) {
        const match = value.match(/((?:AP|Casa)\s*\d{3})\s*[-–]\s*(\d{4,})/i);
        if (!match || seen.has(digits(match[2]))) continue;
        seen.add(digits(match[2]));
        records.push({ name: match[1], code: digits(match[2]), address: '', status: '' });
      }
    }
    return records;
  }

  async function discoverWaterPolicies() {
    const all = [];
    for (let page = 0; page < 8; page += 1) {
      const current = await waitForUi(() => {
        const rows = waterPoliciesOnPage();
        return rows.length ? rows : null;
      }, PORTAL_PAGE_TIMEOUT_MS);
      if (!current) break;
      for (const record of current) {
        if (!all.some(item => item.code === record.code)) all.push(record);
      }
      const signature = current.map(item => item.code).join(',');
      const next = findVisibleUiElement('button', (label, element) =>
        /siguiente|next/.test(clean(label)) && !element.disabled && element.getAttribute('aria-disabled') !== 'true'
      );
      if (!next) break;
      next.click();
      const changed = await waitForUi(() => {
        const after = waterPoliciesOnPage();
        return after.length && after.map(item => item.code).join(',') !== signature ? after : null;
      }, 10_000);
      if (!changed) break;
    }
    return all;
  }

  async function openWaterPayments() {
    const link = findVisibleUiElement('a', (label, element) =>
      /pagos-usuario/.test(String(element.getAttribute('href') || '')) || clean(label) === 'pagos'
    );
    if (!link) return false;
    link.click();
    return Boolean(await waitForUi(() =>
      /pagos-usuario/.test(location.pathname) && document.querySelector('input[name="paymentNumber"], input[type="number"]'),
      PORTAL_PAGE_TIMEOUT_MS
    ));
  }

  function parseWaterPaymentResult(text) {
    const source = String(text || '');
    const lines = uiLines(source);
    const policyMatch = source.match(/p[oó]liza\s*[^0-9]{0,30}(\d{4,})/i);
    const amount = uiAmountAfter(source, 'total a pagar');
    const statusLine = lines.find(line => /pago pendiente|pago en mora|est[aá]s al d[ií]a/i.test(line)) || '';
    const dueDate = uiLineAfter(lines, /^fecha de vencimiento$/i);
    const status = statusFrom(amount, statusLine);
    return {
      policy: policyMatch ? policyMatch[1] : null,
      amount: amount === null && status === 'paid' ? 0 : amount,
      status,
      dueDate,
    };
  }

  async function queryWaterPolicy(policy) {
    const input = document.querySelector('input[name="paymentNumber"], input[type="number"]');
    const submit = findVisibleUiElement('button', label => clean(label) === 'consultar');
    if (!input || !submit) return { error: 'Triple A no mostro el formulario de consulta.' };
    setUiInputValue(input, policy.code);
    input.focus?.();
    submit.click();
    const parsed = await waitForUi(() => {
      if (loginState().challenge) return { challenge: true };
      const text = uiBodyText();
      if (!/total a pagar/i.test(text)) return null;
      if (!new RegExp(escapeRegex(policy.code)).test(text)) return null;
      const result = parseWaterPaymentResult(text);
      return result.amount !== null || result.status !== 'unknown' ? result : null;
    }, PORTAL_UI_TIMEOUT_MS);
    if (parsed?.challenge) return parsed;
    if (!parsed) return { error: `Triple A no mostro el resultado de la poliza ${policy.code}.` };
    return parsed;
  }

  function gasContractsOnPage() {
    const paragraphs = Array.from(document.querySelectorAll('p')).filter(visible).map(uiText);
    const contracts = [];
    const seen = new Set();
    for (let index = 0; index < paragraphs.length; index += 1) {
      const match = paragraphs[index].match(/^(.+?)\s*[-–]\s*(\d{4,})$/);
      if (!match || seen.has(match[2]) || /contrato asociado/i.test(match[1])) continue;
      seen.add(match[2]);
      let address = '';
      for (let cursor = index + 1; cursor < Math.min(paragraphs.length, index + 7); cursor += 1) {
        if (/direcci[oó]n del predio/i.test(paragraphs[cursor])) {
          address = paragraphs[cursor + 1] || '';
          break;
        }
      }
      contracts.push({ name: match[1].trim(), code: match[2], address });
    }
    return contracts;
  }

  function currentGasContractButton() {
    return findVisibleUiElement('button', label => /^(?:ap|casa)\s*\d{3}$/i.test(label));
  }

  function parseGasHomeResult(text) {
    const source = String(text || '');
    const dueLine = uiLines(source).find(line => /^vence\b/i.test(line)) || null;
    const contractMatch = source.match(/contrato\s*n[^0-9]{0,8}(\d{4,})/i);
    const invoiceMatch = source.match(/factura\s*n[^0-9]{0,8}(\d{4,})/i);
    const amount = uiAmountAfter(source, 'total a pagar');
    return {
      contract: contractMatch ? contractMatch[1] : null,
      invoice: invoiceMatch ? invoiceMatch[1] : null,
      dueDate: dueLine,
      amount,
      status: amount === null ? 'unknown' : amount > 0 ? 'pending' : 'paid',
    };
  }

  async function queryGasContract(contract) {
    const selector = currentGasContractButton();
    if (!selector) return { error: 'Gases del Caribe no mostro el selector de contratos.' };
    selector.click();
    const menu = await waitForUi(() => {
      const selectors = '[role="menuitem"], [role="option"], li, button';
      return findVisibleUiElement(selectors, label => label.includes(contract.code) && label !== uiText(selector));
    }, 10_000);
    if (!menu) return { error: `Gases del Caribe no mostro el contrato ${contract.code}.` };
    menu.click();
    await wait(500);
    const inicio = findVisibleUiElement('button', label => clean(label) === 'inicio');
    if (inicio) inicio.click();
    const parsed = await waitForUi(() => {
      if (loginState().challenge) return { challenge: true };
      const text = uiBodyText();
      if (!/total a pagar/i.test(text) || !new RegExp(escapeRegex(contract.code)).test(text)) return null;
      const result = parseGasHomeResult(text);
      return result.amount !== null ? result : null;
    }, PORTAL_UI_TIMEOUT_MS);
    if (parsed?.challenge) return parsed;
    return parsed || { error: `Gases del Caribe no mostro la factura del contrato ${contract.code}.` };
  }

  function unmatchedPortalResult(provider, service, target, code, message) {
    const extra = {
      status: 'unknown',
      deudaCOP: null,
      deudaTotalCOP: null,
      error: message,
    };
    if (provider === 'Triple A') {
      extra.waterPaymentCode = String(code || target.waterPaymentCode || '').trim() || null;
      extra.waterPaymentUrl = 'https://portal.aaa.com.co/polizas';
    } else {
      extra.gasPaymentCode = String(code || target.gasPaymentCode || '').trim() || null;
      extra.gasPaymentUrl = 'https://portal.gascaribe.com/contracts';
    }
    return resultBase(provider, service, target, extra);
  }

  function appendUnmatchedPortalResults(results, config, used, provider, service, codeKey, message) {
    for (const target of config.apartments || []) {
      if (used.has(targetKey(target))) continue;
      results.push(unmatchedPortalResult(provider, service, target, target[codeKey], message));
    }
  }

  async function runAirE(config) {
    const state = loginState();
    if (state.password) return needsLogin('air-e', 'Air-e solicita iniciar sesión. Abre el portal desde Laujim, inicia sesión y vuelve a ejecutar.', { stage: 'login_page' });
    await wait(1800);
    let contract = null;
    for (let attempt = 0; attempt < 12 && !contract; attempt += 1) {
      const resources = performance.getEntriesByType('resource') || [];
      const found = resources.map(item => String(item.name || '').match(/cd_Contrato=([0-9a-f-]{36})/i)).find(Boolean);
      contract = found && found[1];
      if (!contract) await wait(1000);
    }
    if (!contract) return { state: 'error', provider: 'air-e', stage: 'discover_contract', message: 'Air-e no mostró el contrato autenticado. Abre Listado de Facturas en el portal y vuelve a ejecutar.', results: [] };
    const response = await json(`${AIR_E_ENDPOINT}?cd_Contrato=${encodeURIComponent(contract)}&pageIndex=1&pageSize=1000`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!response.ok) return needsLogin('air-e', `Air-e rechazó la consulta (HTTP ${response.status}). Inicia sesión nuevamente desde la app.`, { stage: 'fetch_invoices', httpStatus: response.status, fetchError: response.error || null });
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
    return { state: 'ok', provider: 'air-e', stage: 'fetch_invoices', records: results.length, results };
  }

  async function runWater(config) {
    const state = loginState();
    if (state.password) return needsLogin('water', 'Triple A solicita iniciar sesión. Abre el portal desde Laujim, inicia sesión y vuelve a ejecutar.', { stage: 'login_page' });
    if (state.challenge) return { state: 'needs_verification', provider: 'water', stage: 'turnstile', message: 'Triple A muestra una verificación. Completa la pantalla visible y vuelve a ejecutar.', results: [] };
    // /polizas performs the real NextAuth/BFF request and exposes the
    // Authorization header to the local hook. The login route alone only
    // has an HttpOnly session cookie and made /bff/subscriptions return 401.
    await wait(2500);
    const token = await waitForStoredToken(8000);
    const response = await jsonWithAuthFallback('/bff/subscriptions', token, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'x-app-version': portalAppVersion(),
      },
    });
    if (response.status === 401 || response.status === 403) return needsLogin('water', `Triple A rechazó la sesión (HTTP ${response.status}). Inicia sesión desde la app.`, { stage: 'fetch_subscriptions', httpStatus: response.status, fetchError: response.error || null });
    if (!response.ok) return { state: 'error', provider: 'water', stage: 'fetch_subscriptions', httpStatus: response.status, fetchError: response.error || null, message: `Triple A rechazó la consulta (HTTP ${response.status}).`, results: [] };
    const subscriptions = list(response.payload, ['subscriptions', 'policies', 'items']);
    if (!subscriptions.length) return { state: 'error', provider: 'water', stage: 'parse_subscriptions', message: 'Triple A aceptó la sesión, pero no devolvió pólizas o suscripciones.', results: [] };
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
    if (!results.length) return { state: 'error', provider: 'water', stage: 'match_subscriptions', subscriptionCount: subscriptions.length, message: 'Triple A devolvió pólizas, pero ninguna coincidió con los apartamentos configurados.', results: [] };
    return { state: 'ok', provider: 'water', results };
  }

  async function runGas(config) {
    const state = loginState();
    if (state.password) return needsLogin('gas', 'Gases del Caribe solicita iniciar sesión. Abre el portal desde Laujim, inicia sesión y vuelve a ejecutar.', { stage: 'login_page' });
    if (state.challenge) return { state: 'needs_verification', provider: 'gas', stage: 'turnstile', message: 'Gases del Caribe muestra una verificación. Completa la pantalla visible y vuelve a ejecutar.', results: [] };
    // The protected contracts page hydrates currentUser/localStorage and lets
    // the native hook capture the exact token used by Gascaribe's Axios app.
    await wait(2500);
    const token = await waitForStoredToken(8000);
    const gasRequestOptions = {
      credentials: 'omit',
      headers: { Pragma: 'no-cache' },
    };
    const response = await jsonWithAuthFallback(`${GAS_API}/contracts`, token, gasRequestOptions);
    if (response.status === 401 || response.status === 403) return needsLogin('gas', `Gases del Caribe rechazó la sesión (HTTP ${response.status}). Inicia sesión desde la app.`, { stage: 'fetch_contracts', httpStatus: response.status, fetchError: response.error || null });
    if (!response.ok) return { state: 'error', provider: 'gas', stage: 'fetch_contracts', httpStatus: response.status, fetchError: response.error || null, message: `Gases del Caribe rechazó la consulta (HTTP ${response.status}).`, results: [] };
    const payloadToken = field(response.payload, ['token', 'appToken', 'accessToken', 'authorization']);
    const auth = String(payloadToken || await waitForStoredToken(1500) || token || '').trim();
    const contracts = list(response.payload, ['contracts', 'items']);
    if (!contracts.length) return { state: 'error', provider: 'gas', stage: 'parse_contracts', contractCount: 0, message: 'Gases del Caribe aceptó la sesión, pero no devolvió contratos.', results: [] };
    const results = [];
    const used = new Set();
    let invoiceFailures = 0;
    let matchedContracts = 0;
    let unmatchedContracts = 0;
    let missingContractIds = 0;
    const invoiceFailureDetails = [];
    let firstInvoiceStatus = 0;
    let firstInvoiceError = '';
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
      // Match the official frontend: it always sends this query parameter,
      // even when the value is empty after the authenticated session exists.
      const invoiceUrl = `${GAS_API}/invoices/${encodeURIComponent(contractId)}?g-recaptcha-response=${encodeURIComponent('')}`;
      const invoiceResponse = await jsonWithAuthFallback(invoiceUrl, auth, gasRequestOptions);
      if (!invoiceResponse.ok) {
        invoiceFailures += 1;
        if (!firstInvoiceStatus) firstInvoiceStatus = Number(invoiceResponse.status) || 0;
        if (!firstInvoiceError) firstInvoiceError = invoiceResponse.error || '';
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
    const gasDiagnostics = {
      stage: invoiceFailures || missingContractIds ? 'fetch_invoices' : (unmatchedContracts ? 'match_contracts' : 'parse_invoices'),
      contractCount: contracts.length,
      matchedContracts,
      unmatchedContracts,
      invoiceFailures,
      missingContractIds,
      httpStatus: firstInvoiceStatus || undefined,
      fetchError: firstInvoiceError || undefined,
    };
    if (!results.length && matchedContracts > 0 && (invoiceFailures > 0 || missingContractIds > 0)) {
      const details = [...new Set(invoiceFailureDetails)].slice(0, 3).join(', ');
      const suffix = details ? ` Detalle: ${details}.` : '';
      return {
        state: 'error',
        provider: 'gas',
        ...gasDiagnostics,
        message: `Gases del Caribe asociÃ³ ${matchedContracts} contrato(s) con apartamentos, pero no pudo consultar sus facturas (${invoiceFailures} fallo(s), ${missingContractIds} sin identificador).${suffix}`,
        results: [],
      };
    }
    if (!results.length && matchedContracts === 0) {
      return {
        state: 'error',
        provider: 'gas',
        ...gasDiagnostics,
        message: `Gases del Caribe devolviÃ³ ${contracts.length} contrato(s), pero ninguno coincidiÃ³ con los apartamentos configurados (${unmatchedContracts} sin asociar).`,
        results: [],
      };
    }
    if (!results.length) {
      const reason = invoiceFailures ? ` No se pudieron consultar ${invoiceFailures} contrato(s).` : '';
      return { state: 'error', provider: 'gas', ...gasDiagnostics, message: `Gases del Caribe devolvió contratos, pero ninguno coincidió con los apartamentos configurados.${reason}`, results: [] };
    }
    if (invoiceFailures || missingContractIds || unmatchedContracts) {
      return {
        state: 'warning',
        provider: 'gas',
        ...gasDiagnostics,
        message: `Gases del Caribe obtuvo ${results.length} apartamento(s); quedaron ${invoiceFailures + missingContractIds} contrato(s) sin factura y ${unmatchedContracts} sin asociar.`,
        results,
      };
    }
    return { state: 'ok', provider: 'gas', ...gasDiagnostics, results };
  }

  async function runWaterUi(config) {
    const state = loginState();
    if (state.password) return needsLogin('water', 'Triple A solicita iniciar sesion. Abre el portal desde Laujim, inicia sesion y vuelve a ejecutar.', { stage: 'login_page' });
    if (state.challenge) return { state: 'needs_verification', provider: 'water', stage: 'turnstile', message: 'Triple A muestra una verificacion. Completa la pantalla visible y vuelve a ejecutar.', results: [] };

    await wait(1200);
    const policies = await discoverWaterPolicies();
    if (!policies.length) return { state: 'error', provider: 'water', stage: 'parse_policies', message: 'Triple A no mostro polizas en la sesion autenticada.', results: [] };
    if (!(await openWaterPayments())) return { state: 'error', provider: 'water', stage: 'open_payments', message: 'Triple A no abrio la pantalla de pagos autenticada.', results: [] };

    const results = [];
    const used = new Set();
    let unmatchedPolicies = 0;
    let uiFailures = 0;
    for (const policy of policies) {
      const target = bestTargetMatch(config.apartments || [], policy, 'water', used);
      if (!target) {
        unmatchedPolicies += 1;
        continue;
      }
      used.add(targetKey(target));
      const parsed = await queryWaterPolicy(policy);
      if (parsed?.challenge) {
        return { state: 'needs_verification', provider: 'water', stage: 'turnstile', message: 'Triple A mostro una verificacion durante la consulta. Completa la pantalla visible y vuelve a ejecutar.', results: [] };
      }
      if (parsed?.error || parsed?.amount === null || parsed?.amount === undefined) {
        uiFailures += 1;
        results.push(resultBase('Triple A', 'water', target, {
          waterPaymentCode: policy.code,
          waterPaymentUrl: 'https://portal.aaa.com.co/polizas',
          status: 'error',
          error: parsed?.error || `Triple A no entrego el total de la poliza ${policy.code}.`,
        }));
        continue;
      }
      results.push(resultBase('Triple A', 'water', target, {
        waterPaymentCode: policy.code,
        waterPaymentUrl: 'https://portal.aaa.com.co/polizas',
        status: parsed.status,
        deudaCOP: parsed.amount,
        deudaTotalCOP: parsed.amount,
        numFacturas: parsed.status === 'pending' ? 1 : 0,
        periodo: parsed.dueDate || null,
        fechaVencimiento: parsed.dueDate || null,
      }));
    }

    appendUnmatchedPortalResults(results, config, used, 'Triple A', 'water', 'waterPaymentCode', 'Triple A no tiene esta poliza asociada en la cuenta autenticada.');
    const unmatchedApartments = (config.apartments || []).filter(target => !used.has(targetKey(target))).length;
    const hasWarning = unmatchedPolicies > 0 || uiFailures > 0 || unmatchedApartments > 0;
    return {
      state: hasWarning ? 'warning' : 'ok',
      provider: 'water',
      stage: uiFailures ? 'query_payments' : 'parse_payments',
      policyCount: policies.length,
      matchedPolicies: policies.length - unmatchedPolicies,
      unmatchedPolicies,
      unmatchedApartments,
      uiFailures,
      results,
      message: hasWarning
        ? `Triple A consulto ${policies.length - unmatchedPolicies} poliza(s); ${unmatchedApartments} apartamento(s) no tienen asociacion o resultado confirmado.`
        : `Triple A consulto ${results.length} apartamento(s) desde la pantalla autenticada.`,
    };
  }

  async function runGasUi(config) {
    const state = loginState();
    if (state.password) return needsLogin('gas', 'Gases del Caribe solicita iniciar sesion. Abre el portal desde Laujim, inicia sesion y vuelve a ejecutar.', { stage: 'login_page' });
    if (state.challenge) return { state: 'needs_verification', provider: 'gas', stage: 'turnstile', message: 'Gases del Caribe muestra una verificacion. Completa la pantalla visible y vuelve a ejecutar.', results: [] };

    await wait(1200);
    const contracts = await waitForUi(() => {
      const current = gasContractsOnPage();
      return current.length ? current : null;
    }, PORTAL_PAGE_TIMEOUT_MS);
    if (!contracts || !contracts.length) return { state: 'error', provider: 'gas', stage: 'parse_contracts', contractCount: 0, message: 'Gases del Caribe no mostro contratos en la sesion autenticada.', results: [] };

    const results = [];
    const used = new Set();
    let uiFailures = 0;
    let unmatchedContracts = 0;
    for (const contract of contracts) {
      const target = bestTargetMatch(config.apartments || [], contract, 'gas', used);
      if (!target) {
        unmatchedContracts += 1;
        continue;
      }
      used.add(targetKey(target));
      const parsed = await queryGasContract(contract);
      if (parsed?.challenge) {
        return { state: 'needs_verification', provider: 'gas', stage: 'turnstile', message: 'Gases del Caribe mostro una verificacion durante la consulta. Completa la pantalla visible y vuelve a ejecutar.', results: [] };
      }
      if (parsed?.error || parsed?.amount === null || parsed?.amount === undefined) {
        uiFailures += 1;
        results.push(resultBase('Gases del Caribe', 'gas', target, {
          gasPaymentCode: contract.code,
          gasPaymentUrl: 'https://portal.gascaribe.com/contracts',
          status: 'error',
          error: parsed?.error || `Gases del Caribe no entrego el total del contrato ${contract.code}.`,
        }));
        continue;
      }
      results.push(resultBase('Gases del Caribe', 'gas', target, {
        gasPaymentCode: contract.code,
        gasPaymentUrl: 'https://portal.gascaribe.com/contracts',
        status: parsed.status,
        deudaCOP: parsed.amount,
        deudaTotalCOP: parsed.amount,
        numFacturas: parsed.status === 'pending' ? 1 : 0,
        factura: parsed.invoice || null,
        periodo: parsed.dueDate || null,
        fechaVencimiento: parsed.dueDate || null,
      }));
    }

    appendUnmatchedPortalResults(results, config, used, 'Gases del Caribe', 'gas', 'gasPaymentCode', 'Gases del Caribe no tiene este contrato asociado en la cuenta autenticada.');
    const unmatchedApartments = (config.apartments || []).filter(target => !used.has(targetKey(target))).length;
    const hasWarning = uiFailures > 0 || unmatchedContracts > 0 || unmatchedApartments > 0;
    return {
      state: hasWarning ? 'warning' : 'ok',
      provider: 'gas',
      stage: uiFailures ? 'query_invoices_ui' : 'parse_invoices_ui',
      contractCount: contracts.length,
      matchedContracts: contracts.length - unmatchedContracts,
      unmatchedContracts,
      unmatchedApartments,
      uiFailures,
      results,
      message: hasWarning
        ? `Gases del Caribe consulto ${contracts.length - unmatchedContracts} contrato(s) desde la pantalla autenticada; ${unmatchedApartments} apartamento(s) no tienen asociacion o resultado confirmado.`
        : `Gases del Caribe consulto ${results.length} apartamento(s) desde la pantalla autenticada.`,
    };
  }

  async function run(provider, config) {
    try {
      if (provider === 'air-e') return await runAirE(config || {});
      if (provider === 'water') return await runWaterUi(config || {});
      if (provider === 'gas') return await runGasUi(config || {});
      return { state: 'error', provider, message: 'Servicio no soportado.', results: [] };
    } catch (error) {
      return { state: 'error', provider, stage: 'runner', fetchError: error && error.message || null, message: error && error.message || 'Error local del portal.', results: [] };
    }
  }

  window.LaujimLocalPortalScraper = { run };
})();
