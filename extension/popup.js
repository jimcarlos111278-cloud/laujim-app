(function () {
  'use strict';

  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  var previewArea = document.getElementById('previewArea');
  var previewText = document.getElementById('previewText');
  var btnAutoFill = document.getElementById('btnAutoFill');
  var btnClear = document.getElementById('btnClear');
  var urlList = document.getElementById('urlList');
  var urlCount = document.getElementById('urlCount');
  var btnOpenFB = document.getElementById('btnOpenFB');
  var btnOpenLaujim = document.getElementById('btnOpenLaujim');
  var toastEl = document.getElementById('toast');

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
  }

  function updateStatus(data) {
    if (data && data.title) {
      statusDot.className = 'dot green';
      statusText.textContent = '✓ Datos listos para auto-llenar';
      previewArea.style.display = 'block';
      previewText.textContent = JSON.stringify(data, null, 2);
      btnAutoFill.disabled = false;
    } else {
      statusDot.className = 'dot gray';
      statusText.textContent = 'Esperando datos desde Laujim...';
      previewArea.style.display = 'none';
      btnAutoFill.disabled = true;
    }
  }

  function loadData() {
    chrome.runtime.sendMessage({ type: 'GET_MARKETPLACE_DATA' }, function (data) {
      updateStatus(data);
    });
  }

  function loadUrls() {
    chrome.runtime.sendMessage({ type: 'GET_SAVED_URLS' }, function (urls) {
      urlList.innerHTML = '';
      if (!urls || urls.length === 0) {
        urlList.innerHTML = '<div class="empty">Sin anuncios guardados</div>';
        urlCount.textContent = '0';
        return;
      }
      urlCount.textContent = String(urls.length);
      urls.forEach(function (u) {
        var div = document.createElement('div');
        div.className = 'url-item';
        div.innerHTML =
          '<div class="url-info">' +
            '<div class="url-name">' + escapeHtml(u.aptName || ('Apto #' + u.aptId)) + '</div>' +
            '<div class="url-link" title="' + escapeHtml(u.url) + '">' + escapeHtml(u.url) + '</div>' +
          '</div>' +
          '<div class="url-actions">' +
            '<button class="btn btn-primary btn-sm open-url-btn" data-url="' + escapeHtml(u.url) + '">🌐</button>' +
            '<button class="btn btn-danger btn-sm delete-url-btn" data-aptid="' + u.aptId + '">✕</button>' +
          '</div>';
        urlList.appendChild(div);
      });

      urlList.querySelectorAll('.open-url-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          chrome.tabs.create({ url: btn.dataset.url });
        });
      });
      urlList.querySelectorAll('.delete-url-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          chrome.runtime.sendMessage({ type: 'REMOVE_URL', aptId: Number(btn.dataset.aptid) }, function () {
            showToast('URL eliminada');
            loadUrls();
          });
        });
      });
    });
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  btnAutoFill.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_AUTOFILL' }, function (res) {
        if (res && res.ok) {
          showToast('✓ Auto-llenando...');
        } else {
          showToast('✗ No es una página de Facebook Marketplace');
        }
      });
    });
  });

  btnClear.addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'CLEAR_MARKETPLACE_DATA' }, function () {
      updateStatus(null);
      showToast('Datos limpiados');
    });
  });

  btnOpenFB.addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://web.facebook.com/marketplace/create/rental' });
  });

  btnOpenLaujim.addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://laujim-app.onrender.com' });
  });

  loadData();
  loadUrls();
})();
