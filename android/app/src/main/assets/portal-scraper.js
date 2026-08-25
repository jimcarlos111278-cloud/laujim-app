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

  // The worker WebView may be off-screen while its portal DOM is hydrated.
  // In that mode getClientRects() can be empty even when the table/form is
  // usable. Keep `visible` strict for Turnstile and use this DOM-level test
  // for portal tables, forms and menu controls.
  function domAvailable(element) {
    if (!element || element.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
  }

  function visibleThroughAncestors(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || current.getAttribute('aria-hidden') === 'true') return false;
      current = current.parentElement;
    }
    return !!element && document.documentElement.contains(element);
  }

  function loginState() {
    const body = clean(uiBodyText());
    const password = Array.from(document.querySelectorAll('input[type="password"], input[name*="password" i], input[id*="password" i]')).find(domAvailable);
    const route = clean(`${location.pathname || ''} ${location.search || ''}`);
    const loginRoute = /(?:^|[\\/])login(?:[\\/?#]|$)|signin|sign-in|autentic/.test(route);
    const loginText = /iniciar sesion|inicia sesion|iniciar sesi[oó]n|contrase[nñ]a|correo electr[oó]nico|ingresa a tu cuenta/.test(body);
    const authenticatedPortalText = /mis facturas|listado de facturas|deuda total|tu deuda actual|contratos|polizas/.test(body);
    const challenge = Array.from(document.querySelectorAll(
      '.cf-turnstile, iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], [id*="captcha" i]'
    )).find(visible);
    const hasChallengeText = /captcha|turnstile|no soy un robot|verificacion en dos pasos|codigo de verificacion/.test(body);
    return {
      // SPAs often leave a password input mounted but hidden after login.
      // Treat it as a login page only when the URL or page copy also supports
      // that conclusion; otherwise Air-e is incorrectly abandoned before its
      // invoice request is made.
      password: !!password && (loginRoute || (loginText && !authenticatedPortalText)),
      challenge: !!challenge || (hasChallengeText && (loginRoute || !!password)),
      url: location.href,
      title: document.title || '',
      body: body.slice(0, 1200),
    };
  }

  function challengePending() {
    const response = Array.from(document.querySelectorAll(
      'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name="g-recaptcha-response"], textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"]'
    )).map(element => String(element.value || '').trim()).find(value => value.length > 20);
    if (response) return false;
    // The response input is normally hidden and can remain empty even when
    // the page has no visible challenge. Treating that field alone as a
    // blocker made Triple A report "complete verification" before the
    // credentials were submitted.
    const challenge = Array.from(document.querySelectorAll(
      '.cf-turnstile, iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [id*="captcha" i]'
    )).find(visibleThroughAncestors);
    return !!challenge;
  }

  function inputValue(element, value) {
    if (!element) return false;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    try {
      element.focus();
      if (setter) setter.call(element, String(value == null ? '' : value));
      else element.value = String(value == null ? '' : value);
      ['input', 'change', 'blur'].forEach(type => element.dispatchEvent(new Event(type, { bubbles: true })));
      return String(element.value || '') === String(value == null ? '' : value);
    } catch {
      return false;
    }
  }

  function firstAvailable(selectors, rejectPassword) {
    for (const selector of selectors) {
      const match = Array.from(document.querySelectorAll(selector)).find(element => {
        if (!domAvailable(element) || element.disabled || element.readOnly) return false;
        if (rejectPassword && String(element.type || '').toLowerCase() === 'password') return false;
        return true;
      });
      if (match) return match;
    }
    return null;
  }

  function loginElements() {
    const password = firstAvailable([
      'input[type="password"]', 'input[autocomplete="current-password"]',
      'input[name*="password" i]', 'input[id*="password" i]',
      'input[name*="clave" i]', 'input[id*="clave" i]'
    ]);
    const username = firstAvailable([
      'input[autocomplete="username"]', 'input[type="email"]',
      'input[name*="txtUsername" i]', 'input[name*="username" i]',
      'input[id*="username" i]', 'input[name*="usuario" i]',
      'input[id*="usuario" i]', 'input[name*="email" i]',
      'input[id*="email" i]', 'input[name*="correo" i]',
      'input[id*="correo" i]', 'input[name*="login" i]',
      'input[id*="login" i]', 'input[type="text"]'
    ], true);
    const submit = firstAvailable([
      'button[type="submit"]', 'input[type="submit"]',
      'button[id*="login" i]', 'button[name*="login" i]',
      '[role="button"][id*="login" i]'
    ]) || Array.from(document.querySelectorAll('button, [role="button"], input[type="button"]')).find(element =>
      domAvailable(element) && /iniciar sesion|ingresar|entrar|acceder|continuar/.test(clean(element.innerText || element.value || element.getAttribute('aria-label')))
    );
    return { username, password, submit };
  }

  function submitLogin() {
    const submit = loginElements().submit;
    if (!submit || submit.disabled) return false;
    const nativeBridge = window.LaujimAndroidBridge;
    if (nativeBridge && typeof nativeBridge.clickLogin === 'function') {
      try {
        if (typeof nativeBridge.pressEnter === 'function' && nativeBridge.pressEnter()) return true;
        if (nativeBridge.clickLogin()) return true;
      } catch { }
    }
    try { submit.click(); }
    catch {
      try { submit.form?.requestSubmit(submit); }
      catch { return false; }
    }
    return true;
  }

  async function attemptAutoLogin(provider, config) {
    if (config && config.autoLoginSubmitted) {
      const pageText = clean(uiBodyText());
      const otp = Array.from(document.querySelectorAll(
        'input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[name*="codigo" i], input[id*="codigo" i]'
      )).find(visibleThroughAncestors);
      if (otp) return {
        state: 'needs_verification', provider, stage: 'otp_required',
        message: `${providerLabel(provider)} aceptó las credenciales y solicita un código de verificación.`, results: [],
      };
      const rejected = /credenciales invalidas|credenciales incorrectas|usuario o contrasena|contrasena incorrecta|incorrect password|invalid credentials|datos incorrectos/.test(pageText);
      return needsLogin(provider, rejected
        ? `${providerLabel(provider)} rechazó el usuario o la contraseña guardados.`
        : `${providerLabel(provider)} no confirmó el inicio de sesión después de 25 segundos.`, {
        stage: rejected ? 'credentials_rejected' : 'auto_login_not_confirmed',
      });
    }
    const credentials = config && config.credentials;
    if (!credentials || !String(credentials.username || '').trim() || !String(credentials.password || '')) {
      return needsLogin(provider, `${providerLabel(provider)} solicita iniciar sesión y no tiene credenciales de autologin configuradas.`, { stage: 'credentials_missing' });
    }

    const elements = loginElements();
    if (!elements.username || !elements.password || !elements.submit) {
      return needsLogin(provider, `${providerLabel(provider)} cambió su formulario de acceso y no se pudieron identificar todos los controles.`, {
        stage: 'login_form_not_found',
        loginInputs: document.querySelectorAll('input').length,
        loginButtons: document.querySelectorAll('button, [role="button"]').length,
      });
    }

    let usernameFilled = false;
    let passwordFilled = false;
    const nativeBridge = window.LaujimAndroidBridge;
    if (nativeBridge && typeof nativeBridge.fillLogin === 'function') {
      try {
        const requested = nativeBridge.fillLogin(String(credentials.username), String(credentials.password));
        if (requested) {
          const typed = await waitForUi(() => {
            const current = loginElements();
            return current.username && current.password
              && String(current.username.value || '') === String(credentials.username)
              && String(current.password.value || '') === String(credentials.password);
          }, 12_000);
          usernameFilled = !!typed;
          passwordFilled = !!typed;
        }
      } catch { }
    }
    if (!usernameFilled || !passwordFilled) {
      usernameFilled = inputValue(elements.username, credentials.username);
      passwordFilled = inputValue(elements.password, credentials.password);
    }
    if (!usernameFilled || !passwordFilled) {
      return needsLogin(provider, `${providerLabel(provider)} no permitió completar el formulario de acceso.`, { stage: 'login_fill_failed' });
    }

    // Turnstile/Recaptcha is allowed to complete normally in the phone's real
    // WebView. Never click or bypass the challenge; submit only after its own
    // response token exists or the visible widget has disappeared. Keep the
    // fields filled while the user completes the visible challenge.
    const challengeStartedAt = Date.now();
    while (challengePending() && Date.now() - challengeStartedAt < 180_000) {
      const current = loginElements();
      if (current.username && String(current.username.value || '') !== String(credentials.username)) inputValue(current.username, credentials.username);
      if (current.password && String(current.password.value || '') !== String(credentials.password)) inputValue(current.password, credentials.password);
      await wait(750);
    }
    if (challengePending()) {
      return {
        state: 'needs_verification', provider, stage: 'turnstile_wait',
        message: `${providerLabel(provider)} requiere completar la verificación visible. Las credenciales quedaron preparadas; vuelve a ejecutar tras validarla.`, results: [],
      };
    }

    let enabledAt = Date.now();
    let currentSubmit = loginElements().submit;
    while (currentSubmit?.disabled && Date.now() - enabledAt < 15_000) {
      await wait(250);
      currentSubmit = loginElements().submit;
    }
    if (!currentSubmit || currentSubmit.disabled) {
      return needsLogin(provider, `${providerLabel(provider)} mantuvo deshabilitado el botón de acceso.`, { stage: 'login_submit_disabled' });
    }

    // The Android wrapper sends this outcome through its bridge before it
    // calls submitLogin. That ordering prevents a navigation from destroying
    // the JavaScript context before the worker receives the result.
    return {
      state: 'login_submitted', provider, stage: 'auto_login_submit',
      message: `Autologin enviado a ${providerLabel(provider)}; la app continuará la consulta al confirmar la sesión.`, results: [],
    };
  }

  async function ensureAuthenticated(provider, config) {
    const state = loginState();
    const credentials = config && config.credentials;
    // Some Triple A builds render the challenge before mounting the password
    // field. If credentials are configured, still enter the recovery path so
    // the native WebView can populate the form as soon as it appears.
    if (state.password || (state.challenge && credentials && String(credentials.username || '').trim() && String(credentials.password || ''))) {
      return attemptAutoLogin(provider, config || {});
    }
    if (state.challenge || challengePending()) return {
      state: 'needs_verification', provider, stage: 'turnstile',
      message: `${providerLabel(provider)} muestra una verificación. Complétala en la pantalla visible y vuelve a ejecutar.`, results: [],
    };
    return null;
  }

  function providerLabel(provider) {
    if (provider === 'water') return 'Triple A';
    if (provider === 'gas') return 'Gases del Caribe';
    return 'Air-e';
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

  function contractInvoiceIdCandidates(contract) {
    const values = [];
    const add = value => {
      const text = String(value == null ? '' : value).trim();
      if (text && !values.includes(text)) values.push(text);
    };
    // Gascaribe has returned both an internal id and a human-facing contract
    // number. Depending on the account/portal build, /invoices/{id} accepts
    // one or the other; retry the same contract with the alternate identity
    // instead of turning a valid contract into a false 422 failure.
    ['id', 'contractId', 'contractNumber', 'number', 'subscriptionId', 'externalId', 'code']
      .forEach(name => add(topLevelField(contract, [name])));
    return values;
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

    // Gases uses the contract number as the stable identity. Visible labels
    // can change between portal accounts, so an exact configured contract
    // must win over a stale apartment label.
    if (provider === 'gas' && codeMatch) return 500;

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

  // A single utility account can legitimately serve more than one apartment
  // (for example the house and an apartment sharing the same meter). Use the
  // configured payment code to duplicate one portal result when it is shared;
  // only fall back to the one best label match when the code is not available.
  function matchingTargets(apartments, record, provider, used) {
    // Keep Gases on the pre-1.0.18 one-contract/one-apartment mapping. The
    // shared-code duplication is intentionally limited to Triple A, where
    // the authenticated policy list can contain a shared service account.
    if (provider === 'gas') {
      const best = bestTargetMatch(apartments || [], record, provider, used);
      return best ? [best] : [];
    }
    const codeKey = provider === 'water' ? 'waterPaymentCode' : provider === 'gas' ? 'gasPaymentCode' : 'electricityPaymentCode';
    const portalCode = digits(record?.code);
    // The portal's visible apartment label/address is newer and more
    // trustworthy than a code entered months ago. Prefer that label when it
    // identifies an apartment; otherwise fall back to the configured code.
    const labelMatches = (apartments || []).filter(target => {
      if (used?.has(targetKey(target))) return false;
      const values = allStrings(record).map(value => ({ raw: value, normalized: clean(value) }));
      const number = apartmentNumber(target.name);
      const name = clean(target.name);
      return (number && values.some(value => apartmentNumber(value.raw) === number))
        || (name && values.some(value => value.normalized === name));
    });
    if (labelMatches.length) {
      const exactLabelMatches = labelMatches.filter(target => portalCode && digits(target?.[codeKey]) === portalCode);
      return exactLabelMatches.length ? exactLabelMatches : [labelMatches[0]];
    }
    const exact = (apartments || []).filter(target => {
      if (used?.has(targetKey(target)) || !portalCode) return false;
      return digits(target?.[codeKey]) === portalCode;
    });
    if (exact.length) return exact;
    const best = bestTargetMatch(apartments || [], record, provider, used);
    return best ? [best] : [];
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

  function amountFromFields(value, names) {
    const raw = field(value, names || []);
    return parseAmount(raw);
  }

  function objectRecords(value, depth, seen, output) {
    const level = depth || 0;
    const result = output || [];
    const visited = seen || new Set();
    if (!value || typeof value !== 'object' || level > 6 || visited.has(value)) return result;
    visited.add(value);
    if (!Array.isArray(value)) result.push(value);
    Object.values(value).forEach(child => {
      if (child && typeof child === 'object') objectRecords(child, level + 1, visited, result);
    });
    return result;
  }

  function recordDate(value) {
    const raw = field(value, ['invoiceDate', 'expirationDate', 'dueDate', 'billingPeriod', 'periodo', 'fechaFactura', 'fechaVencimiento', 'createdAt', 'date']);
    const date = raw ? new Date(raw) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
  }

  function recordIsPaid(value) {
    const raw = field(value, ['isPaid', 'paid', 'pagada', 'status', 'state', 'paymentStatus']);
    if (raw === true) return true;
    return /^(?:true|1|paid|pagad[ao]|cancelad[ao]|al\s*d[ií]a|sin\s*deuda)$/i.test(String(raw || ''));
  }

  function financingSummary(payload) {
    const explicit = amountFromFields(payload, [
      'financedDebt', 'deudaFinanciada', 'saldoFinanciado', 'valorFinanciado',
      'financingValue', 'financedAmount', 'amountFinanced', 'totalFinanced',
      'totalFinancing', 'montoFinanciado', 'saldoDeudaFinanciada',
      'financedBalance', 'balanceFinanced', 'debtFinanced', 'deferredDebt',
      'deudaDiferida', 'saldoConvenio', 'deudaConvenio', 'saldoPorFacturar',
    ]);
    const explicitQuota = amountFromFields(payload, [
      'quotaValue', 'cuotaValue', 'cuotaFinanciada', 'installmentValue',
      'monthlyQuota', 'valorCuota', 'valorCuotaFinanciada', 'cuotaMensual',
    ]);
    const rows = [];
    objectRecords(payload).forEach(record => {
      const text = Object.entries(record).map(([key, value]) => `${key}:${typeof value === 'object' ? '' : String(value || '')}`).join(' ');
      if (!/financ|refinanc|diferid|cuota|acuerdo|convenio|plan\s+de\s+pago|brilla|saldoPorFacturar|saldoFinanciado|debtFinanc|deferred/i.test(text)) return;
      const amount = amountFromFields(record, ['pendingBalance', 'saldoPendiente', 'saldoPorFacturar', 'totalValue', 'totalDebt', 'deudaTotal', 'amountDue', 'balanceDue', 'balance', 'amount', 'value', 'financingValue', 'financedAmount', 'financedBalance', 'balanceFinanced', 'debtFinanced', 'deferredDebt', 'deudaDiferida', 'saldoConvenio', 'deudaConvenio']);
      const quota = amountFromFields(record, ['quotaValue', 'cuotaValue', 'installmentValue', 'monthlyQuota', 'valorCuota', 'nextPayment', 'proximoPago', 'nextInstallment', 'cuotaProxima']);
      if (amount === null && quota === null) return;
      const label = field(record, ['conceptDescription', 'productDescription', 'description', 'concept', 'name', 'type', 'status']);
      const key = `${amount ?? ''}|${quota ?? ''}|${String(label || '')}`;
      if (rows.some(row => row.key === key)) return;
      rows.push({
        key,
        concepto: label ? String(label).replace(/\s+/g, ' ').trim().slice(0, 160) : 'Financiación',
        saldoCOP: amount,
        cuotaCOP: quota,
        cuotas: field(record, ['billedQuotas', 'paidQuotas', 'quotas', 'numberOfQuotas']) ?? null,
        numero: field(record, ['financingNumber', 'numeroFinanciacion', 'number', 'agreementNumber']) ?? null,
        fechaInicio: field(record, ['startDate', 'fechaInicio', 'financingStartDate']) ?? null,
        saldoInicialCOP: amountFromFields(record, ['initialBalance', 'saldoInicial', 'valorInicial']) ?? null,
      });
    });
    const balances = rows.map(row => row.saldoCOP).filter(value => value !== null);
    return {
      financiadaCOP: explicit ?? (balances.length ? balances.reduce((sum, value) => sum + value, 0) : null),
      cuotaFinanciadaCOP: explicitQuota ?? rows.map(row => row.cuotaCOP).find(value => value !== null) ?? null,
      financiacion: rows.slice(0, 20).map(({ key, ...row }) => row),
    };
  }

  function tripleAInvoiceSummary(invoices) {
    const listItems = Array.isArray(invoices) ? invoices : [];
    const unpaid = listItems.filter(invoice => !recordIsPaid(invoice));
    const sorted = listItems.slice().sort((left, right) => (recordDate(right)?.getTime() || 0) - (recordDate(left)?.getTime() || 0));
    const latest = sorted[0] || null;
    const latestDate = recordDate(latest);
    const latestPeriod = latestDate ? `${latestDate.getUTCFullYear()}-${latestDate.getUTCMonth()}` : null;
    const current = latestPeriod
      ? unpaid.filter(invoice => {
        const date = recordDate(invoice);
        return date && `${date.getUTCFullYear()}-${date.getUTCMonth()}` === latestPeriod;
      })
      : unpaid.slice(0, 1);
    const rows = current.length ? current : unpaid.slice(0, 1);
    const monthValues = rows.map(invoice => amountFromFields(invoice, ['monthValue', 'monthlyValue', 'valorMes', 'deudaMes', 'invoiceValue', 'valorFactura', 'currentInvoiceAmount', 'currentAmount', 'saldoActual', 'saldoDeudaActual', 'deudaActual', 'currentBalance', 'balanceCurrent', 'amountDue', 'pendingValue', 'pendingAmount', 'totalToPay'])).filter(value => value !== null);
    const totalValues = unpaid.map(invoice => amountFromFields(invoice, ['totalValue', 'pendingBalance', 'pendingValue', 'totalToPay', 'amountDue', 'totalDebt', 'deudaTotal', 'balanceDue', 'balance', 'amount', 'value'])).filter(value => value !== null);
    return {
      deudaMesCOP: monthValues.length ? monthValues.reduce((sum, value) => sum + value, 0) : null,
      deudaTotalCOP: totalValues.length ? totalValues.reduce((sum, value) => sum + value, 0) : null,
      numFacturas: unpaid.length,
      factura: field(latest, ['invoiceNumber', 'invoiceId', 'factura', 'id']) || null,
      periodo: field(latest, ['invoiceDate', 'billingPeriod', 'periodo', 'expirationDate']) || null,
      status: unpaid.length ? (monthValues.length && monthValues.reduce((sum, value) => sum + value, 0) > 0 ? 'pending' : 'paid') : 'paid',
    };
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
      deudaMesCOP: null,
      deudaTotalCOP: null,
      deudaLabel: 'Deuda Total',
      numFacturas: null,
      factura: null,
      periodo: null,
      facturaValorCOP: null,
      deudaConveniosCOP: null,
      financiadaCOP: null,
      cuotaFinanciadaCOP: null,
      financiacion: [],
      debtSource: null,
      debtEndpointStatus: null,
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
    return String(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || document.documentElement?.textContent || '');
  }

  function uiLines(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  function findVisibleUiElement(selector, matcher) {
    return Array.from(document.querySelectorAll(selector || '*')).find(element => {
      if (!domAvailable(element)) return false;
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

  function portalPair(text) {
    // Triple A renders the selector as "AP 303 • 975245" (and uses
    // "Casa 101 • 11156" for the house). The previous parser only accepted
    // a hyphen/colon, so it discarded every visible policy option.
    return String(text || '').match(/((?:AP|Casa)\s*\d{3})\s*(?:[-\u2013\u2014:\u2022\u00b7]\s*)?(\d{4,})/i);
  }

  function waterPolicyMenuItems() {
    return Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'))
      .filter(domAvailable)
      .map(element => {
        const text = uiText(element);
        const match = portalPair(text);
        return match ? {
          element,
          text,
          name: match[1],
          code: digits(match[2]),
        } : null;
      })
      .filter(Boolean);
  }

  function waterPolicySelectorTrigger() {
    // Triple A does not expose a semantic button here. The same policy text
    // is repeated across several nested MUI containers; sorting only by text
    // length selected MuiCardHeader-root, whose programmatic click does
    // nothing. The actual control is the smallest container that includes
    // both the selected policy and the down-arrow icon.
    const arrowSelector = '.material-icons, [class*="arrow-down"], [class*="ri-arrow-down"]';
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
      .filter(domAvailable)
      .map(element => ({
        element,
        text: uiText(element),
        descendants: element.querySelectorAll('*').length,
      }))
      .filter(item => item.text && item.text.length < 180
        && portalPair(item.text)
        && item.element.querySelector(arrowSelector))
      .sort((left, right) => left.descendants - right.descendants || left.text.length - right.text.length);
    return candidates[0]?.element || null;
  }

  function waterPoliciesOnPage() {
    const records = [];
    const seen = new Set();
    for (const item of waterPolicyMenuItems()) {
      if (!item.code || seen.has(item.code)) continue;
      seen.add(item.code);
      records.push({ name: item.name, code: item.code, address: '', status: '' });
    }
    if (records.length) return records;
    const rows = Array.from(document.querySelectorAll('[role="row"], tr')).filter(domAvailable);
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('[role="gridcell"], td')).filter(domAvailable).map(uiText);
      let name = cells[1] || '';
      let code = digits(cells[2] || '');
      const address = cells[3] || '';
      const rowText = uiText(row);
      if ((!name || code.length < 4) && rowText) {
        const match = portalPair(rowText);
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
      const candidates = Array.from(document.querySelectorAll('p, li, [role="cell"]')).filter(domAvailable).map(uiText)
        .concat(uiLines(uiBodyText()));
      for (const value of candidates) {
        const match = portalPair(value);
        if (!match || seen.has(digits(match[2]))) continue;
        seen.add(digits(match[2]));
        records.push({ name: match[1], code: digits(match[2]), address: '', status: '' });
      }
    }
    return records;
  }

  function firstWaterPolicyFromText(text) {
    for (const line of uiLines(text)) {
      const match = portalPair(line);
      if (match) return { name: match[1], code: digits(match[2]) };
    }
    return null;
  }

  function selectedWaterPolicyCode() {
    return firstWaterPolicyFromText(uiBodyText())?.code || null;
  }

  function waterPolicyOption(policy) {
    const code = digits(policy?.code);
    if (!code) return null;
    return waterPolicyMenuItems().find(item => item.code === code)?.element || null;
  }

  async function selectWaterPolicy(policy) {
    const code = digits(policy?.code);
    if (!code) return false;
    const alreadySelected = selectedWaterPolicyCode() === code && /total\s+a\s+pagar/i.test(uiBodyText());

    if (alreadySelected) {
      if (!waterPolicyMenuItems().length) return true;
      const toggle = waterPolicySelectorTrigger();
      if (!toggle) return false;
      toggle.click();
      return Boolean(await waitForUi(() => {
        const text = uiBodyText();
        return !waterPolicyMenuItems().length
          && selectedWaterPolicyCode() === code
          && /total\s+a\s+pagar/i.test(text) ? true : null;
      }, 5_000));
    }

    // Discovery intentionally leaves the menu open. Reuse the matching
    // semantic menu item instead of searching all repeated text containers.
    let option = waterPolicyOption(policy);
    if (!option) {
      await openWaterPolicySelector();
      option = await waitForUi(() => waterPolicyOption(policy), 5_000);
    }
    if (!option) return false;
    option.click();
    return Boolean(await waitForUi(() => {
      const currentCode = selectedWaterPolicyCode();
      const text = uiBodyText();
      return currentCode === code
        && !waterPolicyMenuItems().length
        && /total\s+a\s+pagar/i.test(text)
        && new RegExp(escapeRegex(code)).test(text) ? true : null;
    }, PORTAL_UI_TIMEOUT_MS));
  }

  async function discoverWaterPolicies() {
    const selector = waterPolicySelectorTrigger();
    const openMenu = waterPolicyMenuItems();
    if (selector || openMenu.length) {
      return await openWaterPolicySelector();
    }
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

  async function openWaterPolicySelector() {
    const menuPolicies = waterPolicyMenuItems().map(item => ({
      name: item.name,
      code: item.code,
      address: '',
      status: '',
    }));
    if (menuPolicies.length) return menuPolicies;
    const visiblePolicies = waterPoliciesOnPage();
    const toggle = waterPolicySelectorTrigger();
    if (!toggle) return visiblePolicies;
    toggle.click();
    return (await waitForUi(() => {
      const policies = waterPolicyMenuItems().map(item => ({
        name: item.name,
        code: item.code,
        address: '',
        status: '',
      }));
      return policies.length ? policies : null;
    }, 5_000)) || visiblePolicies;
  }

  async function openWaterPayments() {
    // The reliable debt value lives on /inicio. Do not navigate from this
    // injected runner: a full SPA/document navigation would destroy the
    // JavaScript promise that must answer the Android bridge.
    return Boolean(await waitForUi(() => {
      const text = uiBodyText();
      return /tu\s+deuda\s+actual/i.test(text) && /total\s+a\s+pagar/i.test(text) ? true : null;
    }, PORTAL_PAGE_TIMEOUT_MS));
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
    if (/tu\s+deuda\s+actual|total\s+a\s+pagar/i.test(uiBodyText())) {
      if (!(await selectWaterPolicy(policy))) return { error: `Triple A no pudo seleccionar la poliza ${policy.code}.` };
      const selectedText = uiBodyText();
      const parsed = parseWaterPaymentResult(selectedText);
      if (parsed.amount !== null || parsed.status !== 'unknown') return parsed;
      return { error: `Triple A no mostro el total de la poliza ${policy.code}.` };
    }
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
    const paragraphs = Array.from(document.querySelectorAll('p, li, button, [role="option"], [role="menuitem"], [role="menuitemradio"]')).filter(domAvailable).map(uiText);
    const contracts = [];
    const seen = new Set();
    const candidates = paragraphs.concat(uiLines(uiBodyText()));
    const addContract = (name, code) => {
      const normalizedCode = String(code || '').replace(/\D/g, '');
      if (normalizedCode.length < 4 || seen.has(normalizedCode)) return;
      seen.add(normalizedCode);
      contracts.push({ name: String(name || '').trim(), code: normalizedCode, address: '' });
    };
    // Some portal builds render “AP 203 · 66499518” in one element while
    // others render “Contrato: 66499518” without the apartment label.
    // Capture both shapes before the legacy paragraph parser runs.
    candidates.forEach(candidate => {
      const text = String(candidate || '').replace(/\s+/g, ' ').trim();
      if (!text || /contrato asociado/i.test(text)) return;
      const apartmentMatch = text.match(/\b(?:ap|apto|apartamento|casa)\s*#?\s*(\d{3})\s*(?:[•·\-–—:|]\s*)+(\d{4,})\b/i);
      if (apartmentMatch) addContract('AP ' + apartmentMatch[1], apartmentMatch[2]);
      const codeMatch = text.match(/\b(?:contrato|contracto)\s*(?:n[°ºo.]*)?\s*[:#-]?\s*(\d{4,})\b/i);
      if (codeMatch) addContract('', codeMatch[1]);
      if (/^\d{6,}$/.test(text)) addContract('', text);
    });
    for (let index = 0; index < candidates.length; index += 1) {
      const match = candidates[index].match(/^(.+?)\s*[-\u2013\u2014:]\s*(\d{4,})$/);
      if (!match || seen.has(match[2]) || /contrato asociado/i.test(match[1])) continue;
      seen.add(match[2]);
      let address = '';
      for (let cursor = index + 1; cursor < Math.min(candidates.length, index + 7); cursor += 1) {
        if (/direcci[o\u00f3]n del predio/i.test(candidates[cursor])) {
          address = candidates[cursor + 1] || '';
          break;
        }
      }
      contracts.push({ name: match[1].trim(), code: match[2], address });
    }
    return contracts;
  }

  function currentGasContractButton() {
    return findVisibleUiElement('button', label => /^(?:ap|casa)\s*\d{3}(?:\s*[•·\-]\s*\d+)?$/i.test(label));
  }

  function parseGasHomeResult(text) {
    const source = String(text || '');
    const normalized = clean(source);
    const dueLine = uiLines(source).find(line => /^vence\b/i.test(line)) || null;
    const periodMatch = source.match(/\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+20\d{2}\b/i);
    const contractMatch = source.match(/contrato\s*n[^0-9]{0,8}(\d{4,})/i);
    const invoiceMatch = source.match(/factura\s*n[^0-9]{0,8}(\d{4,})/i);
    // Gascaribe uses two card layouts: pending cards say "Total a pagar",
    // while paid cards say only "Pagado" followed by the historical invoice
    // amount. The historical amount is not current debt.
    const receiptAmount = uiAmountAfter(source, 'total a pagar') ?? uiAmountAfter(source, 'pagado');
    const paidByText = /estas\s+al\s+dia|al\s+dia|sin\s+deuda|pagad[oa]|pago\s+realizad[oa]/.test(normalized);
    const amount = paidByText ? 0 : receiptAmount;
    return {
      contract: contractMatch ? contractMatch[1] : null,
      invoice: invoiceMatch ? invoiceMatch[1] : null,
      dueDate: dueLine,
      periodo: periodMatch ? periodMatch[0] : null,
      receiptAmount,
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
      const hasReceiptSummary = /total a pagar|tu deuda actual|est[aá]s\s+al\s+d[ií]a|sin\s+deuda|pagad[oa]/i.test(text);
      if (!hasReceiptSummary || !new RegExp(escapeRegex(contract.code)).test(text)) return null;
      const result = parseGasHomeResult(text);
      return result.amount !== null || result.status === 'paid' ? result : null;
    }, PORTAL_UI_TIMEOUT_MS);
    if (parsed?.challenge) return parsed;
    return parsed || { error: `Gases del Caribe no mostro la factura del contrato ${contract.code}.` };
  }

  function unmatchedPortalResult(provider, service, target, code, message) {
    // Gases' authenticated list contains contracts with a current invoice;
    // a configured contract absent from that list is the portal's way of
    // indicating no invoice is pending. Keep genuine query failures as
    // errors, but don't present a zero-debt contract as a scraper failure.
    const noGasInvoice = provider === 'Gases del Caribe';
    const extra = noGasInvoice ? {
      status: 'paid',
      deudaCOP: 0,
      deudaTotalCOP: 0,
      numFacturas: 0,
      deudaText: 'Deuda Total: $0 (al día; sin factura pendiente visible).',
      portalNoInvoice: true,
      error: null,
    } : {
      status: 'unknown',
      deudaCOP: null,
      deudaTotalCOP: null,
      error: message,
    };
    if (provider === 'Triple A') {
      extra.waterPaymentCode = String(code || target.waterPaymentCode || '').trim() || null;
      extra.waterPaymentUrl = target.waterPaymentUrl || null;
    } else {
      extra.gasPaymentCode = String(code || target.gasPaymentCode || '').trim() || null;
      extra.gasPaymentUrl = target.gasPaymentUrl || null;
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
    const loginOutcome = await ensureAuthenticated('air-e', config);
    if (loginOutcome) return loginOutcome;
    await wait(1800);
    let contract = null;
    for (let attempt = 0; attempt < 12 && !contract; attempt += 1) {
      const resources = performance.getEntriesByType('resource') || [];
      const found = resources.map(item => String(item.name || '').match(/cd_Contrato=([0-9a-f-]{36})/i)).find(Boolean);
      contract = found && found[1];
      if (!contract) await wait(1000);
    }
    if (!contract) return { state: 'error', provider: 'air-e', stage: 'discover_contract', message: 'Air-e no mostró el contrato autenticado. Abre Listado de Facturas en el portal y vuelve a ejecutar.', results: [] };
    // The visible Air-e SPA can keep its bearer token in JavaScript memory
    // instead of a durable cookie. The background WebView restores that token
    // through the native session vault; send it through the same auth fallback
    // used by the other portal runners before declaring the session expired.
    const token = await waitForStoredToken(3000);
    const response = await jsonWithAuthFallback(`${AIR_E_ENDPOINT}?cd_Contrato=${encodeURIComponent(contract)}&pageIndex=1&pageSize=1000`, token, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) return needsLogin('air-e', `Air-e rechazó la consulta (HTTP ${response.status}). Inicia sesión nuevamente desde la app.`, { stage: 'fetch_invoices', httpStatus: response.status, fetchError: response.error || null });
    const items = Array.isArray(response.payload && response.payload.items) ? response.payload.items : list(response.payload, ['items', 'documents', 'invoices']);
    const grouped = {};
    items.forEach(invoice => {
      const nic = String(invoice && invoice.cd_Poliza || '').trim();
      if (!nic || /PAGAD[AO]/.test(String(invoice.cd_EstadosPagoDocumento || '').toUpperCase())) return;
      const total = parseAmount(field(invoice, ['amt_DeudaTotal', 'deudaTotal', 'DeudaTotal']));
      const balance = parseAmount(field(invoice, ['amt_SaldoConsulta', 'saldoConsulta', 'SaldoConsulta']));
      const month = parseAmount(field(invoice, ['amt_ValorMes', 'valorMes', 'ValorMes', 'amt_ValorFactura', 'valorFactura', 'ValorFactura', 'amt_Valor', 'valor', 'Valor']));
      const financed = parseAmount(field(invoice, ['amt_ValorFinanciado', 'valorFinanciado', 'saldoFinanciado', 'deudaFinanciada', 'financedDebt', 'financingValue']));
      const quota = parseAmount(field(invoice, ['amt_ValorCuota', 'valorCuota', 'cuotaFinanciada', 'quotaValue']));
      const group = grouped[nic] || { total: [], balance: [], rows: [], invoices: [] };
      if (total !== null) group.total.push(total); else if (balance !== null) group.balance.push(balance);
      group.rows.push({ invoice, month, financed, quota, date: recordDate(invoice) });
      group.invoices.push(invoice);
      grouped[nic] = group;
    });
    const results = (config.apartments || []).filter(target => target.electricityPaymentCode).map(target => {
      const nic = String(target.electricityPaymentCode).replace(/\D/g, '');
      const group = grouped[nic] || { total: [], balance: [], rows: [], invoices: [] };
      const debt = group.total.length ? Math.max.apply(Math, group.total) : group.balance.reduce((sum, value) => sum + value, 0);
      const rows = group.rows.slice().sort((left, right) => (right.date?.getTime() || 0) - (left.date?.getTime() || 0));
      const latest = rows[0] || null;
      const latestPeriod = latest?.date ? `${latest.date.getUTCFullYear()}-${latest.date.getUTCMonth()}` : null;
      const currentRows = latestPeriod ? rows.filter(row => row.date && `${row.date.getUTCFullYear()}-${row.date.getUTCMonth()}` === latestPeriod) : rows.slice(0, 1);
      const current = currentRows.length ? currentRows : rows.slice(0, 1);
      const monthValues = current.map(row => row.month).filter(value => value !== null);
      const financing = financingSummary(group.invoices);
      const financedValues = rows.map(row => row.financed).filter(value => value !== null);
      const quotaValues = rows.map(row => row.quota).filter(value => value !== null);
      const deudaMesCOP = monthValues.length ? monthValues.reduce((sum, value) => sum + value, 0) : null;
      const deudaTotalCOP = debt;
      return resultBase('Air-e', 'electricity', target, {
        nic,
        status: deudaTotalCOP > 0 ? 'pending' : 'paid',
        deudaCOP: deudaTotalCOP,
        deudaMesCOP,
        deudaConveniosCOP: financedValues.length ? Math.max.apply(Math, financedValues) : financing.financiadaCOP,
        deudaTotalCOP,
        factura: field(latest?.invoice, ['invoiceNumber', 'invoiceId', 'factura', 'id']) || null,
        periodo: field(latest?.invoice, ['invoiceDate', 'billingPeriod', 'periodo', 'fechaFactura']) || null,
        numFacturas: group.invoices.length,
        financiadaCOP: financedValues.length ? Math.max.apply(Math, financedValues) : financing.financiadaCOP,
        cuotaFinanciadaCOP: quotaValues.length ? Math.max.apply(Math, quotaValues) : financing.cuotaFinanciadaCOP,
        financiacion: financing.financiacion,
        debtSource: 'invoice_fields',
        deudaText: deudaTotalCOP > 0 ? `Deuda Total del NIC: $${deudaTotalCOP.toLocaleString('es-CO')}.` : 'Deuda Total del NIC: $0 (al día).',
      });
    });
    return { state: 'ok', provider: 'air-e', stage: 'fetch_invoices', records: results.length, results };
  }

  async function fetchTripleASummary(subscription, token) {
    const id = field(subscription, ['id', 'subscriptionId', 'subscription_id']);
    if (id == null || id === '') return { error: 'Triple A no devolvió el identificador interno de la póliza.' };
    const headers = { 'X-Requested-With': 'XMLHttpRequest', 'x-app-version': portalAppVersion() };
    const invoicesResponse = await jsonWithAuthFallback(`/bff/invoices/subscription/${encodeURIComponent(String(id))}`, token, { headers });
    if (!invoicesResponse.ok) return { invoiceEndpointStatus: invoicesResponse.status || 0, error: `Triple A no devolvió las facturas de la póliza (HTTP ${invoicesResponse.status || 'sin respuesta'}).` };
    const invoiceItems = list(invoicesResponse.payload, ['invoices', 'items']);
    const invoiceSummary = tripleAInvoiceSummary(invoiceItems);
    let debtPayload = null;
    let debtEndpointStatus = 0;
    let debtRoute = '';
    for (const url of [
      `/bff/debts/subscription/${encodeURIComponent(String(id))}`,
      `/bff/debt/subscription/${encodeURIComponent(String(id))}`,
      `/bff/subscriptions/${encodeURIComponent(String(id))}/debt`,
    ]) {
      const response = await jsonWithAuthFallback(url, token, { headers });
      debtEndpointStatus = response.status || 0;
      if (response.ok) {
        debtPayload = response.payload;
        debtRoute = url;
        break;
      }
      if (![404, 405].includes(Number(response.status))) break;
    }
    const financingPayloads = [];
    for (const url of [
      `/bff/deferred-debts/subscription/${encodeURIComponent(String(id))}`,
      `/bff/financing/subscription/${encodeURIComponent(String(id))}`,
    ]) {
      const response = await jsonWithAuthFallback(url, token, { headers });
      if (response.ok) financingPayloads.push(response.payload);
    }
    const debtRows = debtPayload ? list(debtPayload, ['debts', 'items']) : [];
    const total = debtPayload && !/deferred|financ/i.test(debtRoute)
      ? amountFromFields(debtPayload, ['totalDebts', 'totalDebt', 'deudaTotal', 'totalPending', 'totalPendingDebt', 'totalDebtValue'])
        ?? (debtRows.length ? debtRows.map(row => amountFromFields(row, ['totalValue', 'pendingBalance', 'totalDebt', 'deudaTotal', 'amountDue', 'balanceDue', 'amount', 'value'])).filter(value => value !== null).reduce((sum, value) => sum + value, 0) : null)
      : null;
    const debtMonth = debtPayload && !/deferred|financ/i.test(debtRoute)
      ? amountFromFields(debtPayload, [
        'deudaMes', 'monthDebt', 'monthlyDebt', 'currentDebt', 'currentMonthDebt',
        'currentInvoice', 'currentInvoiceValue', 'currentInvoiceAmount', 'currentAmount',
        'invoiceValue', 'valorMes', 'valorFactura', 'saldoActual', 'saldoDeudaActual',
        'deudaActual', 'currentBalance', 'balanceCurrent',
      ])
      : null;
    const financing = financingSummary(financingPayloads.length ? financingPayloads : (debtPayload || invoicesResponse.payload));
    const convenio = financing.financiadaCOP;
    const invoiceTotal = invoiceSummary.deudaTotalCOP ?? invoiceSummary.deudaMesCOP;
    const combinedTotal = total ?? (
      convenio !== null && invoiceTotal !== null ? invoiceTotal + convenio : invoiceTotal
    );
    return {
      deudaMesCOP: debtMonth ?? invoiceSummary.deudaMesCOP,
      deudaConveniosCOP: convenio,
      deudaTotalCOP: combinedTotal,
      numFacturas: invoiceSummary.numFacturas,
      factura: invoiceSummary.factura,
      periodo: invoiceSummary.periodo,
      facturaValorCOP: invoiceSummary.deudaMesCOP,
      financiadaCOP: convenio,
      cuotaFinanciadaCOP: financing.cuotaFinanciadaCOP,
      financiacion: financing.financiacion,
      debtSource: total !== null ? 'debt_endpoint' : 'invoice_fallback',
      debtEndpointStatus,
    };
  }

  async function fetchGasDebtSummary(contractId, auth) {
    if (!contractId) return { debtEndpointStatus: 0, debtSource: 'invoice_fallback' };
    const response = await jsonWithAuthFallback(`${GAS_API}/contracts/debt/${encodeURIComponent(String(contractId))}`, auth, {
      credentials: 'omit',
      headers: { Pragma: 'no-cache' },
    });
    if (!response.ok) return { debtEndpointStatus: response.status || 0, debtSource: 'invoice_fallback' };
    const rows = list(response.payload, ['debts', 'items', 'invoices', 'contracts']);
    const explicitTotal = amountFromFields(response.payload, ['totalDebts', 'totalDebt', 'deudaTotal', 'totalDebtValue', 'totalToPay', 'totalValue', 'totalAmount', 'saldoTotal', 'totalCurrentDebt', 'total'])
      ?? (rows.length ? rows.map(row => amountFromFields(row, ['pendingBalance', 'saldoPendiente', 'saldoPorFacturar', 'totalValue', 'totalDebt', 'deudaTotal', 'amountDue', 'balanceDue', 'totalToPay', 'amount', 'value'])).filter(value => value !== null).reduce((sum, value) => sum + value, 0) : null);
    const month = amountFromFields(response.payload, [
      'deudaMes', 'monthDebt', 'monthlyDebt', 'currentDebt', 'currentMonthDebt',
      'currentInvoice', 'currentInvoiceValue', 'currentInvoiceAmount', 'currentAmount',
      'invoiceValue', 'valorMes', 'valorFactura', 'saldoActual', 'saldoDeudaActual',
      'deudaActual', 'currentBalance', 'balanceCurrent',
    ]) ?? (rows.length ? amountFromFields(rows[0], [
      'deudaMes', 'monthDebt', 'monthlyDebt', 'currentDebt', 'currentMonthDebt',
      'currentInvoice', 'currentInvoiceValue', 'currentInvoiceAmount', 'currentAmount',
      'invoiceValue', 'valorMes', 'valorFactura', 'saldoActual', 'saldoDeudaActual',
      'deudaActual', 'currentBalance', 'balanceCurrent',
    ]) : null);
    const financing = financingSummary(response.payload);
    const total = explicitTotal ?? (
      month !== null && financing.financiadaCOP !== null
        ? month + financing.financiadaCOP
        : month
    );
    return {
      deudaTotalCOP: total,
      deudaMesCOP: month,
      deudaConveniosCOP: financing.financiadaCOP,
      financiadaCOP: financing.financiadaCOP,
      cuotaFinanciadaCOP: financing.cuotaFinanciadaCOP,
      financiacion: financing.financiacion,
      debtSource: total !== null ? 'debt_endpoint' : 'invoice_fallback',
      debtEndpointStatus: response.status || 0,
    };
  }

  async function runWater(config) {
    const loginOutcome = await ensureAuthenticated('water', config);
    if (loginOutcome) return loginOutcome;
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
      const summary = await fetchTripleASummary(subscription, token).catch(error => ({ error: error.message }));
      const rawAmount = field(subscription, ['pendingValue', 'pendingAmount', 'debt', 'deudaTotal', 'totalDebt', 'amountDue', 'totalDue', 'balanceDue', 'saldoTotal', 'saldoPendiente', 'total', 'amount', 'balance', 'saldo']);
      const amount = parseAmount(rawAmount);
      const rawStatus = field(subscription, ['status', 'state', 'paymentStatus']);
      const code = field(subscription, ['subscriptionExternalId', 'externalId', 'subscriptionId', 'policyNumber', 'poliza', 'policy', 'id']);
      const total = summary.deudaTotalCOP ?? (amount === null && /pending|pendiente|vencid|mora/i.test(String(rawStatus || '')) ? null : (amount === null ? 0 : Math.max(0, amount)));
      const month = summary.deudaMesCOP ?? (amount === null && /pending|pendiente|vencid|mora/i.test(String(rawStatus || '')) ? null : (amount === null ? 0 : Math.max(0, amount)));
      results.push(resultBase('Triple A', 'water', target, {
        waterPaymentCode: String(code || target.waterPaymentCode || '').trim() || null,
        status: total === null ? statusFrom(amount, rawStatus || field(subscription, ['isPending', 'pending', 'pendiente'])) : (total > 0 ? 'pending' : 'paid'),
        deudaCOP: total,
        deudaMesCOP: month,
        deudaConveniosCOP: summary.deudaConveniosCOP ?? summary.financiadaCOP ?? null,
        deudaTotalCOP: total,
        facturaValorCOP: summary.facturaValorCOP ?? month,
        numFacturas: summary.numFacturas ?? null,
        factura: summary.factura || field(subscription, ['invoiceNumber', 'invoiceId', 'factura']) || null,
        periodo: summary.periodo || field(subscription, ['invoiceDate', 'billingPeriod', 'periodo']) || null,
        financiadaCOP: summary.financiadaCOP ?? null,
        cuotaFinanciadaCOP: summary.cuotaFinanciadaCOP ?? null,
        financiacion: summary.financiacion || [],
        debtSource: summary.debtSource || 'subscription_fallback',
        debtEndpointStatus: summary.debtEndpointStatus ?? null,
        error: summary.error || null,
      }));
    }
    if (!results.length) return { state: 'error', provider: 'water', stage: 'match_subscriptions', subscriptionCount: subscriptions.length, message: 'Triple A devolvió pólizas, pero ninguna coincidió con los apartamentos configurados.', results: [] };
    return { state: 'ok', provider: 'water', results };
  }

  async function runGas(config) {
    const loginOutcome = await ensureAuthenticated('gas', config);
    if (loginOutcome) return loginOutcome;
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
      const invoiceIdCandidates = contractInvoiceIdCandidates(contract);
      if (!invoiceIdCandidates.length) {
        missingContractIds += 1;
        continue;
      }
      // Match the official frontend: it always sends this query parameter,
      // even when the value is empty after the authenticated session exists.
      let invoiceResponse = null;
      let invoiceId = '';
      for (const candidate of invoiceIdCandidates) {
        invoiceId = candidate;
        const invoiceUrl = `${GAS_API}/invoices/${encodeURIComponent(candidate)}?g-recaptcha-response=${encodeURIComponent('')}`;
        invoiceResponse = await jsonWithAuthFallback(invoiceUrl, auth, gasRequestOptions);
        if (invoiceResponse.ok) break;
        // 400/404/422 means this identity is not the invoice resource key;
        // try the next identifier. Auth/session failures must not be masked.
        if (![400, 404, 422].includes(Number(invoiceResponse.status))) break;
      }
      if (!invoiceResponse || !invoiceResponse.ok) {
        // A paid contract can remain visible after its current invoice is
        // settled. Gascaribe may answer 404/422 for that invoice resource;
        // preserve the authenticated contract as an explicit $0 result.
        if ([404, 422].includes(Number(invoiceResponse?.status))) {
          const debtIdentifier = String(field(contract, ['id', 'contractId', 'contractNumber', 'number', 'externalId', 'code']) || invoiceId || '').trim();
          const debtSummary = await fetchGasDebtSummary(debtIdentifier, auth).catch(() => ({}));
          const total = debtSummary.deudaTotalCOP ?? 0;
          used.add(String(target.id || target.name));
          results.push(resultBase('Gases del Caribe', 'gas', target, {
            gasPaymentCode: String(target.gasPaymentCode || invoiceId),
            status: total > 0 ? 'pending' : 'paid',
            deudaCOP: total,
            deudaMesCOP: debtSummary.deudaMesCOP ?? 0,
            deudaConveniosCOP: debtSummary.deudaConveniosCOP ?? debtSummary.financiadaCOP ?? null,
            deudaTotalCOP: total,
            financiadaCOP: debtSummary.financiadaCOP ?? null,
            cuotaFinanciadaCOP: debtSummary.cuotaFinanciadaCOP ?? null,
            financiacion: debtSummary.financiacion || [],
            debtSource: debtSummary.debtSource || 'no_current_invoice',
            debtEndpointStatus: debtSummary.debtEndpointStatus ?? null,
            numFacturas: 0,
            factura: field(contract, ['invoiceNumber', 'invoiceId', 'factura']) || null,
            periodo: field(contract, ['expirationDate', 'dueDate', 'fechaVencimiento']) || null,
            portalNoInvoice: true,
            error: null,
          }));
          continue;
        }
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
      const receipt = (unpaid[0] && unpaid[0].invoice) || invoices[0] || null;
      const debtIdentifier = String(field(contract, ['id', 'contractId', 'contractNumber', 'number', 'externalId', 'code']) || invoiceId || '').trim();
      const debtSummary = await fetchGasDebtSummary(debtIdentifier, auth).catch(error => ({ debtSource: 'invoice_fallback', debtEndpointStatus: 0, error: error.message }));
    const total = debtSummary.deudaTotalCOP ?? debt;
      const latest = invoices.slice().sort((left, right) => (recordDate(right)?.getTime() || 0) - (recordDate(left)?.getTime() || 0))[0] || receipt;
      const month = amountFromFields(latest, ['monthValue', 'monthlyValue', 'valorMes', 'deudaMes', 'invoiceValue', 'valorFactura', 'invoiceAmount', 'totalToPay', 'amountDue', 'pendingValue', 'pendingAmount', 'couponValue']);
      used.add(String(target.id || target.name));
      results.push(resultBase('Gases del Caribe', 'gas', target, {
        gasPaymentCode: String(target.gasPaymentCode || invoiceId),
        status: total === null || total > 0 ? 'pending' : 'paid',
        deudaCOP: total,
        deudaMesCOP: debtSummary.deudaMesCOP ?? month ?? total,
        deudaConveniosCOP: debtSummary.deudaConveniosCOP ?? debtSummary.financiadaCOP ?? null,
        deudaTotalCOP: total,
        facturaValorCOP: debtSummary.deudaMesCOP ?? month ?? total,
        financiadaCOP: debtSummary.financiadaCOP ?? null,
        cuotaFinanciadaCOP: debtSummary.cuotaFinanciadaCOP ?? null,
        financiacion: debtSummary.financiacion || [],
        debtSource: debtSummary.debtSource || 'invoice_fallback',
        debtEndpointStatus: debtSummary.debtEndpointStatus ?? null,
        numFacturas: unpaid.length,
        factura: field(latest, ['id', 'invoiceNumber', 'factura']) || null,
        periodo: field(latest, ['expirationDate', 'dueDate', 'fechaVencimiento', 'invoiceDate', 'periodo']) || null,
        error: debtSummary.error || null,
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
        message: `Gases del Caribe asoció ${matchedContracts} contrato(s) con apartamentos, pero no pudo consultar sus facturas (${invoiceFailures} fallo(s), ${missingContractIds} sin identificador).${suffix}`,
        results: [],
      };
    }
    if (!results.length && matchedContracts === 0) {
      return {
        state: 'error',
        provider: 'gas',
        ...gasDiagnostics,
        message: `Gases del Caribe devolvió ${contracts.length} contrato(s), pero ninguno coincidió con los apartamentos configurados (${unmatchedContracts} sin asociar).`,
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
    const loginOutcome = await ensureAuthenticated('water', config);
    if (loginOutcome) return loginOutcome;

    const hydrationStartedAt = Date.now();
    await wait(1200);
    if (!(await openWaterPayments())) {
      return {
        state: 'error', provider: 'water', stage: 'open_debt_home',
        url: location.href, title: document.title || '',
        message: 'Triple A esta autenticado, pero no muestra Tu deuda actual. Abre Inicio en el portal y vuelve a ejecutar.',
        results: [],
      };
    }
    const policies = await discoverWaterPolicies();
    if (!policies.length) {
      return {
        state: 'error', provider: 'water', stage: 'parse_policies', policyCount: 0,
        domRows: document.querySelectorAll('[role="row"], tr').length,
        domParagraphs: document.querySelectorAll('p, li, [role="cell"]').length,
        domTextLength: uiBodyText().length,
        hydrationWaitMs: Date.now() - hydrationStartedAt,
        url: location.href, title: document.title || '',
        message: 'Triple A autentico la sesion, pero la pantalla de polizas no termino de hidratarse o cambio su estructura.',
        results: [],
      };
    }
    const results = [];
    const used = new Set();
    let unmatchedPolicies = 0;
    let uiFailures = 0;
    for (const policy of policies) {
      const targets = matchingTargets(config.apartments || [], policy, 'water', used);
      if (!targets.length) {
        unmatchedPolicies += 1;
        continue;
      }
      targets.forEach(target => used.add(targetKey(target)));
      const parsed = await queryWaterPolicy(policy);
      if (parsed?.challenge) {
        return { state: 'needs_verification', provider: 'water', stage: 'turnstile', message: 'Triple A mostro una verificacion durante la consulta. Completa la pantalla visible y vuelve a ejecutar.', results: [] };
      }
      if (parsed?.error || ((parsed?.amount === null || parsed?.amount === undefined) && parsed?.status !== 'paid')) {
        uiFailures += 1;
        for (const target of targets) results.push(resultBase('Triple A', 'water', target, {
            waterPaymentCode: policy.code,
            waterPaymentUrl: target.waterPaymentUrl || null,
            status: 'error',
            error: parsed?.error || `Triple A no entrego el total de la poliza ${policy.code}.`,
          }));
        continue;
      }
      for (const target of targets) results.push(resultBase('Triple A', 'water', target, {
          waterPaymentCode: policy.code,
          waterPaymentUrl: target.waterPaymentUrl || null,
          status: parsed.status,
          deudaCOP: parsed.amount,
          deudaMesCOP: parsed.amount,
          deudaTotalCOP: parsed.amount,
          facturaValorCOP: parsed.amount,
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
    const loginOutcome = await ensureAuthenticated('gas', config);
    if (loginOutcome) return loginOutcome;

    const hydrationStartedAt = Date.now();
    await wait(1200);
    const contracts = await waitForUi(() => {
      const current = gasContractsOnPage();
      return current.length ? current : null;
    }, PORTAL_PAGE_TIMEOUT_MS);
    if (!contracts || !contracts.length) return {
      state: 'error', provider: 'gas', stage: 'parse_contracts', contractCount: 0,
      domParagraphs: document.querySelectorAll('p, li').length,
      domTextLength: uiBodyText().length,
      hydrationWaitMs: Date.now() - hydrationStartedAt,
      url: location.href, title: document.title || '',
      message: 'Gases del Caribe autentico la sesion, pero la pantalla de contratos no termino de hidratarse o cambio su estructura.',
      results: [],
    };

    const results = [];
    const used = new Set();
    let uiFailures = 0;
    let unmatchedContracts = 0;
    for (const contract of contracts) {
      const targets = matchingTargets(config.apartments || [], contract, 'gas', used);
      if (!targets.length) {
        unmatchedContracts += 1;
        continue;
      }
      targets.forEach(target => used.add(targetKey(target)));
      const parsed = await queryGasContract(contract);
      if (parsed?.challenge) {
        return { state: 'needs_verification', provider: 'gas', stage: 'turnstile', message: 'Gases del Caribe mostro una verificacion durante la consulta. Completa la pantalla visible y vuelve a ejecutar.', results: [] };
      }
      if (parsed?.error || parsed?.amount === null || parsed?.amount === undefined) {
        uiFailures += 1;
        for (const target of targets) results.push(resultBase('Gases del Caribe', 'gas', target, {
            gasPaymentCode: contract.code,
            gasPaymentUrl: target.gasPaymentUrl || null,
            status: 'error',
            error: parsed?.error || `Gases del Caribe no entrego el total del contrato ${contract.code}.`,
          }));
        continue;
      }
      for (const target of targets) results.push(resultBase('Gases del Caribe', 'gas', target, {
          gasPaymentCode: contract.code,
          gasPaymentUrl: target.gasPaymentUrl || null,
          status: parsed.status,
          deudaCOP: parsed.amount,
          deudaMesCOP: parsed.amount,
          deudaTotalCOP: parsed.amount,
          numFacturas: parsed.status === 'pending' ? 1 : 0,
          factura: parsed.invoice || null,
          periodo: parsed.periodo || parsed.dueDate || null,
          fechaVencimiento: parsed.dueDate || null,
          facturaValorCOP: parsed.receiptAmount ?? null,
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
      if (provider === 'water') {
        // Prefer the authenticated BFF: it exposes the current invoice and
        // accumulated debt without scraping a changing card layout. Keep the
        // visible reader as a compatibility fallback for old portal builds.
        const apiResult = await runWater(config || {});
        if (['ok', 'warning'].includes(apiResult?.state)) return apiResult;
        const uiResult = await runWaterUi(config || {});
        return uiResult?.results?.length || uiResult?.state === 'needs_verification' ? uiResult : apiResult;
      }
      if (provider === 'gas') {
        const apiResult = await runGas(config || {});
        if (['ok', 'warning'].includes(apiResult?.state)) return apiResult;
        const uiResult = await runGasUi(config || {});
        return uiResult?.results?.length || uiResult?.state === 'needs_verification' ? uiResult : apiResult;
      }
      return { state: 'error', provider, message: 'Servicio no soportado.', results: [] };
    } catch (error) {
      return { state: 'error', provider, stage: 'runner', fetchError: error && error.message || null, message: error && error.message || 'Error local del portal.', results: [] };
    }
  }

  window.LaujimLocalPortalScraper = { run, submitLogin };
})();
