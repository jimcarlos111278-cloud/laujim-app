let currentTab = 'tabKeypad';
let dialNumber = '';
let tenantsList = [];
let blockedList = [];

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupDialer();
  loadData();

  document.getElementById('btnSync').addEventListener('click', handleSync);
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.getElementById('btnClearBlocked').addEventListener('click', clearBlocked);
  document.getElementById('btnRequestRole').addEventListener('click', requestRole);
  document.getElementById('contactSearch').addEventListener('input', filterContacts);

  const btnSetDefault = document.getElementById('btnSetDefaultDialer');
  if (btnSetDefault) {
    btnSetDefault.addEventListener('click', () => {
      if (window.CallGuardNative && window.CallGuardNative.requestDefaultDialer) {
        window.CallGuardNative.requestDefaultDialer();
      }
    });
  }

  const btnSettingsDialer = document.getElementById('btnSettingsRoleDialer');
  if (btnSettingsDialer) {
    btnSettingsDialer.addEventListener('click', () => {
      if (window.CallGuardNative && window.CallGuardNative.requestDefaultDialer) {
        window.CallGuardNative.requestDefaultDialer();
      }
    });
  }
});

function setupNavigation() {
  const items = document.querySelectorAll('.nav-item');
  items.forEach(item => {
    item.addEventListener('click', () => {
      items.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const tabId = item.getAttribute('data-tab');
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      currentTab = tabId;

      if (tabId === 'tabBlocked') renderBlocked();
      if (tabId === 'tabContacts') renderContacts();
      if (tabId === 'tabSettings') updateSettingsView();
    });
  });
}

function setupDialer() {
  const keys = document.querySelectorAll('.key-btn');
  const input = document.getElementById('phoneInput');
  const backspace = document.getElementById('btnBackspace');
  const callBtn = document.getElementById('btnCall');

  keys.forEach(k => {
    k.addEventListener('click', () => {
      const val = k.getAttribute('data-val');
      dialNumber += val;
      vibrate(20);
      updateDialerDisplay();
    });
  });

  // Long press on '0' to type '+'
  const zeroKey = document.querySelector('.key-btn[data-val="0"]');
  if (zeroKey) {
    let zeroTimer = null;
    zeroKey.addEventListener('touchstart', () => {
      zeroTimer = setTimeout(() => {
        if (dialNumber.endsWith('0')) {
          dialNumber = dialNumber.slice(0, -1) + '+';
        } else {
          dialNumber += '+';
        }
        vibrate(40);
        updateDialerDisplay();
      }, 500);
    });
    zeroKey.addEventListener('touchend', () => clearTimeout(zeroTimer));
  }

  backspace.addEventListener('click', () => {
    dialNumber = dialNumber.slice(0, -1);
    vibrate(15);
    updateDialerDisplay();
  });

  let bsTimer = null;
  backspace.addEventListener('touchstart', () => {
    bsTimer = setTimeout(() => {
      dialNumber = '';
      vibrate(50);
      updateDialerDisplay();
    }, 600);
  });
  backspace.addEventListener('touchend', () => clearTimeout(bsTimer));

  callBtn.addEventListener('click', () => {
    if (!dialNumber) return;
    vibrate(35);
    makeCall(dialNumber);
  });
}

function vibrate(ms) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) {}
}

function updateDialerDisplay() {
  const input = document.getElementById('phoneInput');
  const backspace = document.getElementById('btnBackspace');
  input.value = formatPhone(dialNumber);

  if (dialNumber.length > 0) {
    backspace.classList.remove('hidden');
    searchDialerMatches();
  } else {
    backspace.classList.add('hidden');
    document.getElementById('dialerMatches').classList.add('hidden');
  }
}

function formatPhone(num) {
  if (!num) return '';
  const clean = num.replace(/\D/g, '');
  if (clean.length === 10) {
    return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6)}`;
  }
  return num;
}

function searchDialerMatches() {
  const container = document.getElementById('dialerMatches');
  if (!dialNumber) {
    container.classList.add('hidden');
    return;
  }
  const query = dialNumber.replace(/\D/g, '');
  const matches = (tenantsList || []).filter(t => {
    const p = (t.phone || '').replace(/\D/g, '');
    const n = (t.name || '').toLowerCase();
    return p.includes(query) || n.includes(dialNumber.toLowerCase());
  }).slice(0, 2);

  if (matches.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.innerHTML = matches.map(m => `
    <div class="match-item">
      <div class="match-left" onclick="selectMatch('${m.phone}')">
        <div class="match-avatar">${(m.name || 'I').substring(0, 1).toUpperCase()}</div>
        <div>
          <div style="display:flex;align-items:center;">
            <span class="match-name">${m.name}</span>
            <span class="match-apt">Apto ${m.apartment}</span>
          </div>
          <div style="font-size:11px;color:#94A3B8;margin-top:1px;">${m.phone}</div>
        </div>
      </div>
      <div class="match-actions">
        <button class="action-btn-call" style="width:32px;height:32px;" onclick="makeCall('${m.phone}')" title="Llamar">📞</button>
      </div>
    </div>
  `).join('');
  container.classList.remove('hidden');
}

window.selectMatch = function(phone) {
  dialNumber = phone.replace(/\D/g, '');
  updateDialerDisplay();
  makeCall(dialNumber);
};

window.setDialNumber = function(num) {
  dialNumber = (num || '').trim();
  updateDialerDisplay();
  const keypadTab = document.querySelector('.nav-item[data-tab="tabKeypad"]');
  if (keypadTab) keypadTab.click();
};

window.onAppResume = function() {
  loadData();
};

function makeCall(number) {
  if (window.CallGuardNative && window.CallGuardNative.callNumber) {
    window.CallGuardNative.callNumber(number);
  } else {
    window.location.href = 'tel:' + encodeURIComponent(number);
  }
}

function openWhatsApp(number) {
  if (window.CallGuardNative && window.CallGuardNative.openWhatsApp) {
    window.CallGuardNative.openWhatsApp(number);
  } else {
    const clean = number.replace(/\D/g, '');
    const full = clean.startsWith('57') ? clean : ('57' + clean);
    window.open('https://wa.me/' + full, '_blank');
  }
}

function loadData() {
  if (window.CallGuardNative) {
    try {
      const statusRaw = window.CallGuardNative.getStatus();
      const status = JSON.parse(statusRaw);
      updateStatusDisplay(status);

      const tenantsRaw = window.CallGuardNative.getTenants ? window.CallGuardNative.getTenants() : '[]';
      tenantsList = JSON.parse(tenantsRaw || '[]');
      if (!tenantsList || tenantsList.length === 0) {
        handleSync();
      } else {
        renderContacts();
      }

      const blockedRaw = window.CallGuardNative.getBlockedCalls();
      blockedList = JSON.parse(blockedRaw || '[]');
      updateBlockedBadge();
    } catch (e) {
      console.error('Error loading native data', e);
    }
  } else {
    // Simulated in browser for testing
    tenantsList = [
      { id: 1, name: 'Jim Carlos Varela', apartment: '101', phone: '3001234567' },
      { id: 2, name: 'Ana Gomez', apartment: '201', phone: '3109876543' }
    ];
    renderContacts();
    updateStatusDisplay({ isDefaultDialer: false, roleGranted: true, allowedCount: 2 });
  }
}

function updateStatusDisplay(status) {
  const badge = document.getElementById('dbStatusBadge');
  const text = document.getElementById('dbStatusText');
  const count = status.allowedCount || tenantsList.length;

  badge.className = 'db-status connected';
  text.textContent = `Laujim DB (${count})`;

  // Default Dialer Banner
  const banner = document.getElementById('bannerDefaultDialer');
  if (banner) {
    if (status.isDefaultDialer) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  }

  // Settings View Statuses
  const dialerDesc = document.getElementById('defaultDialerStatusDesc');
  if (dialerDesc) {
    dialerDesc.textContent = status.isDefaultDialer
      ? '✅ Laujim es la app predeterminada para llamadas.'
      : '⚠️ Laujim NO está predeterminada. Toca para asignar.';
  }

  const roleDesc = document.getElementById('roleStatusDesc');
  if (roleDesc) {
    roleDesc.textContent = status.roleGranted
      ? '✅ Filtro Call Screening activo.'
      : '⚠️ Permiso de screening no otorgado.';
  }
}

function handleSync() {
  const badge = document.getElementById('dbStatusBadge');
  const text = document.getElementById('dbStatusText');
  badge.className = 'db-status loading';
  text.textContent = 'Sincronizando...';

  if (window.CallGuardNative && window.CallGuardNative.syncWithServer) {
    const resRaw = window.CallGuardNative.syncWithServer();
    try {
      const res = JSON.parse(resRaw);
      if (res.ok) {
        setTimeout(loadData, 300);
      } else {
        badge.className = 'db-status error';
        text.textContent = 'Error de conexión';
      }
    } catch (e) {
      badge.className = 'db-status error';
      text.textContent = 'Error';
    }
  }
}

function renderContacts() {
  const container = document.getElementById('contactsList');
  const badge = document.getElementById('tenantCountBadge');
  badge.textContent = tenantsList.length;

  if (tenantsList.length === 0) {
    container.innerHTML = '<div class="empty-state">No hay inquilinos sincronizados.<br><br><button class="btn-primary-sm" onclick="handleSync()">Sincronizar con Laujim</button></div>';
    return;
  }

  container.innerHTML = tenantsList.map(t => {
    const initial = (t.name || 'I').substring(0, 1).toUpperCase();
    return `
      <div class="contact-card">
        <div class="contact-card-left" onclick="selectMatch('${t.phone}')">
          <div class="contact-avatar">${initial}</div>
          <div class="contact-info">
            <span class="contact-name">${t.name}</span>
            <div class="contact-meta">
              <span class="contact-apt">Apto ${t.apartment}</span>
              <span class="contact-phone">${formatPhone(t.phone)}</span>
            </div>
          </div>
        </div>
        <div class="contact-actions">
          <button class="action-btn-call" onclick="makeCall('${t.phone}')" title="Llamar">📞</button>
          <button class="action-btn-wa" onclick="openWhatsApp('${t.phone}')" title="WhatsApp">💬</button>
        </div>
      </div>
    `;
  }).join('');
}

function filterContacts() {
  const query = (document.getElementById('contactSearch').value || '').toLowerCase().trim();
  const cards = document.querySelectorAll('.contact-card');
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(query) ? 'flex' : 'none';
  });
}

function renderBlocked() {
  const container = document.getElementById('blockedList');
  if (blockedList.length === 0) {
    container.innerHTML = '<div class="empty-state">No hay llamadas bloqueadas registradas.<br>El filtro está vigilando 24/7.</div>';
    return;
  }

  container.innerHTML = blockedList.map(b => {
    const isFraud = (b.category === 'fraud');
    const tagClass = isFraud ? 'tag-fraud' : 'tag-unknown';
    const tagText = isFraud ? '⚠️ Sospecha Fraude' : '🔒 Desconocido';
    const date = new Date(b.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="blocked-card">
        <div class="blocked-top">
          <span class="blocked-number">${b.phone}</span>
          <span class="blocked-tag ${tagClass}">${tagText}</span>
        </div>
        <div class="blocked-reason">${b.reason || 'Llamada no autorizada'}</div>
        <div class="blocked-bottom">
          <span class="blocked-time">${date}</span>
          <div class="blocked-actions">
            <button class="btn-wa-sm" onclick="openWhatsApp('${b.phone}')">Ver WA</button>
            <button class="btn-auth-sm" onclick="authorizeNumber('${b.phone}')">Autorizar</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function updateBlockedBadge() {
  const badge = document.getElementById('blockedBadgeCount');
  if (blockedList.length > 0) {
    badge.textContent = blockedList.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function clearBlocked() {
  if (window.CallGuardNative && window.CallGuardNative.clearBlockedCalls) {
    window.CallGuardNative.clearBlockedCalls();
  }
  blockedList = [];
  renderBlocked();
  updateBlockedBadge();
}

function requestRole() {
  if (window.CallGuardNative && window.CallGuardNative.requestRole) {
    window.CallGuardNative.requestRole();
  }
}

function authorizeNumber(number) {
  if (window.CallGuardNative && window.CallGuardNative.authorizeNumber) {
    window.CallGuardNative.authorizeNumber(number);
  }
  alert('Número ' + number + ' autorizado en la lista de confianza.');
  loadData();
}

function saveSettings() {
  const url = document.getElementById('txtServerUrl').value.trim();
  alert('Ajustes guardados. Conectando...');
  handleSync();
}
