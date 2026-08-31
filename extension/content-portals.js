(function () {
  'use strict';

  // Guards against double injection from manifest + dynamic injection.
  if (window.__LAUJIM_PORTALS_LOADED__) return;
  window.__LAUJIM_PORTALS_LOADED__ = true;

  const PORTALS = [
    {
      provider: 'air-e',
      label: 'Air-e',
      matches: /^https:\/\/portal\.air-e\.com\/login/i,
      selectors: {
        username: 'input[name*="txtUsername"], input[name*="Login$"], input[name="txtUsername"]',
        password: 'input[name*="txtPassword"], input[name="txtPassword"]'
      }
    },
    {
      provider: 'triple-a',
      label: 'Triple A',
      matches: /^https:\/\/portal\.aaa\.com\.co\/(iniciar-sesion|login)/i,
      selectors: {
        username: 'input[name="email"]',
        password: 'input[name="password"]'
      }
    },
    {
      provider: 'gascaribe',
      label: 'Gases del Caribe',
      matches: /^https:\/\/portal\.gascaribe\.com\/login/i,
      selectors: {
        username: '#email',
        password: '#password'
      }
    }
  ];

  function detectPortal() {
    const href = window.location.href;
    for (const p of PORTALS) {
      if (p.matches.test(href)) return p;
    }
    return null;
  }

  function reportError(context, error) {
    try {
      chrome.runtime.sendMessage({
        type: 'REPORT_EXTENSION_ERROR',
        context: 'content-portals:' + context,
        message: String(error && error.message || error)
      });
    } catch (e) { /* noop */ }
  }

  function showNotice(text) {
    let el = document.getElementById('__LAUJIM_PORTALS_NOTICE__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__LAUJIM_PORTALS_NOTICE__';
      el.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:2147483647;' +
        'background:#111827;color:#fff;padding:10px 14px;border-radius:8px;' +
        'font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);';
      document.body.appendChild(el);
    }
    el.textContent = text;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { if (el.parentNode) el.parentNode.remove(); }, 8000);
  }

  function fillAndSubmit(portal, credentials) {
    const username = document.querySelector(portal.selectors.username);
    const password = document.querySelector(portal.selectors.password);
    if (!username || !password) {
      showNotice('[Laujim] No se encontró el formulario de login de ' + portal.label + '.');
      return false;
    }
    const set = (input, value) => {
      const proto = Object.getPrototypeOf(input);
      if (proto && proto.setter) {
        proto.setter.call(input, value, 'Laujim');
      } else {
        input.value = value;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(username, credentials.username);
    set(password, credentials.password);
    showNotice('[Laujim] Credenciales de ' + portal.label + ' cargadas.');
    return true;
  }

  function attempt(portal, attemptNum, maxAttempts) {
    chrome.runtime.sendMessage({ type: 'GET_PORTAL_CREDENTIALS', provider: portal.provider }, (res) => {
      if (chrome.runtime.lastError || !res) {
        if (attemptNum < maxAttempts) setTimeout(() => attempt(portal, attemptNum + 1, maxAttempts), 1500);
        return;
      }
      if (!res.ok || res.provider !== portal.provider || !res.credentials) {
        if (attemptNum < maxAttempts) setTimeout(() => attempt(portal, attemptNum + 1, maxAttempts), 1500);
        return;
      }
      try {
        fillAndSubmit(portal, res.credentials);
      } catch (e) {
        reportError('fill', e);
      }
    });
  }

  const portal = detectPortal();
  if (!portal) return;

  // Wait a moment for the form to render, then autofill.
  setTimeout(() => attempt(portal, 0, 60), 1200);
  window.addEventListener('load', () => {
    setTimeout(() => attempt(portal, 0, 60), 500);
  });
})();