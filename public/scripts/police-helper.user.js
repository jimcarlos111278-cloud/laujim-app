// ==UserScript==
// @name         Laujim App - Asistente Policía
// @namespace    https://laujim-app.onrender.com
// @version      1.0.0
// @description  Auto-acepta términos, auto-llena cédula y envía el resultado a Laujim App
// @author       Laujim App
// @match        https://antecedentes.policia.gov.co:7005/WebJudicial/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=policia.gov.co
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      laujim-app.onrender.com
// @connect      localhost
// ==/UserScript==

(function () {
  'use strict';

  const APP_URL = (function () {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:1011';
    }
    return 'https://laujim-app.onrender.com';
  })();

  const AUTH_TOKEN = 'laujim laujim';

  function getCedulaFromHash() {
    if (window.location.hash) {
      const hash = window.location.hash.replace(/^#/, '');
      const match = hash.match(/cedula=(\d+)/) || hash.match(/^(\d+)$/);
      if (match) return match[1];
    }
    return null;
  }

  function showNotification(msg) {
    try {
      if (typeof GM_notification !== 'undefined') {
        GM_notification({ text: msg, title: 'Laujim App', timeout: 5000 });
      }
    } catch (e) { console.log('[Laujim] ' + msg); }
  }

  function sendResult(status, detail) {
    const cedula = getCedulaFromHash();
    if (!cedula) return;
    const payload = { document: cedula, status, detail, source: 'userscript' };
    console.log('[Laujim] Sending result:', payload);

    try {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method: 'POST',
          url: APP_URL + '/api/antecedentes/userscript-result',
          headers: {
            'Content-Type': 'application/json',
            'x-auth-token': AUTH_TOKEN,
          },
          data: JSON.stringify(payload),
          onload: function (r) {
            console.log('[Laujim] Result sent, response:', r.status, r.responseText);
            showNotification('Resultado enviado a Laujim App');
          },
          onerror: function (e) {
            console.error('[Laujim] Error sending result:', e);
            showNotification('Error al enviar resultado');
          },
        });
      } else {
        fetch(APP_URL + '/api/antecedentes/userscript-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
          body: JSON.stringify(payload),
        }).catch(function (e) { console.error('[Laujim] Fetch error:', e); });
      }
    } catch (e) { console.error('[Laujim] Error:', e); }
  }

  function waitForElement(selector, timeout) {
    return new Promise(function (resolve) {
      if (document.querySelector(selector)) return resolve(document.querySelector(selector));
      var observer = new MutationObserver(function () {
        if (document.querySelector(selector)) {
          observer.disconnect();
          resolve(document.querySelector(selector));
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      if (timeout) setTimeout(function () { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  async function init() {
    console.log('[Laujim] Assistant loaded on police site');

    // Check for result page (already submitted)
    var bodyText = document.body.innerText || '';
    if (bodyText.includes('NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES')) {
      console.log('[Laujim] Detected: CLEAN');
      sendResult('clean', '');
      showNotification('Sin antecedentes - resultado enviado');
      return;
    }
    if (/REGISTRA ANTECEDENTES|TIENE ANTECEDENTES|CON ANTECEDENTES|SÍ REGISTRA/i.test(bodyText)) {
      console.log('[Laujim] Detected: FLAGGED');
      sendResult('flagged', 'Tiene antecedentes judiciales');
      showNotification('Con antecedentes - resultado enviado');
      return;
    }

    // Auto-accept terms
    var acceptBtn = document.getElementById('continuarBtn');
    var termsCheck = document.getElementById('aceptaOption');
    if (acceptBtn || termsCheck) {
      console.log('[Laujim] Accepting terms...');
      if (termsCheck) termsCheck.checked = true;
      if (acceptBtn) {
        acceptBtn.click();
        await new Promise(function (r) { return setTimeout(r, 2000); });
        await new Promise(function (r) {
          var observer = new MutationObserver(function () {
            if (!document.getElementById('continuarBtn')) {
              observer.disconnect();
              r();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          setTimeout(function () { observer.disconnect(); r(); }, 5000);
        });
      }
    }

    // Auto-fill cedula
    var cedula = getCedulaFromHash();
    if (cedula) {
      var input = await waitForElement('#cedulaInput', 5000);
      if (input) {
        console.log('[Laujim] Auto-filling cedula: ' + cedula);
        input.value = cedula;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Watch for result after submission
    var resultObserver = new MutationObserver(function () {
      var text = document.body.innerText || '';
      if (text.includes('NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES')) {
        resultObserver.disconnect();
        console.log('[Laujim] Detected: CLEAN (after submit)');
        sendResult('clean', '');
        showNotification('Sin antecedentes - resultado enviado');
      } else if (/REGISTRA ANTECEDENTES|TIENE ANTECEDENTES|CON ANTECEDENTES|SÍ REGISTRA/i.test(text)) {
        resultObserver.disconnect();
        console.log('[Laujim] Detected: FLAGGED (after submit)');
        sendResult('flagged', 'Tiene antecedentes judiciales');
        showNotification('Con antecedentes - resultado enviado');
      }
    });
    resultObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

    console.log('[Laujim] Assistant ready. Cédula: ' + (cedula || 'no encontrada'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
