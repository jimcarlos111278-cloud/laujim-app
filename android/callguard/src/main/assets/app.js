let currentTab = 'tabHistory';
let activeFilter = 'all';
let dialNumber = '';
let tenantsList = [];
let blockedList = [];
let deviceContacts = [];
let lookupCache = {};
let lookupTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupDialer();
  setupChips();
  loadData();

  const btnSync = document.getElementById('btnSync');
  if (btnSync) btnSync.addEventListener('click', handleSync);
  const btnSave = document.getElementById('btnSaveSettings');
  if (btnSave) btnSave.addEventListener('click', saveSettings);
  const btnReqRole = document.getElementById('btnRequestRole');
  if (btnReqRole) btnReqRole.addEventListener('click', requestRole);
  const searchInput = document.getElementById('contactSearch');
  if (searchInput) searchInput.addEventListener('input', filterContacts);

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

function setupChips() {
  const chips = document.querySelectorAll('.chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.getAttribute('data-filter');
      renderHistory();
    });
  });
}

function setupNavigation() {
  const items = document.querySelectorAll('.nav-item');
  items.forEach(item => {
    item.addEventListener('click', () => {
      items.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const tabId = item.getAttribute('data-tab');
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      const targetPane = document.getElementById(tabId);
      if (targetPane) targetPane.classList.add('active');
      currentTab = tabId;

      if (tabId === 'tabHistory') renderHistory();
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
    hideLookupPreview();
  }

  // Trigger lookup preview when 10+ digits are typed
  const clean = dialNumber.replace(/\D/g, '');
  if (clean.length >= 10) {
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(() => triggerLookupPreview(clean), 400);
  } else {
    hideLookupPreview();
  }
}

function triggerLookupPreview(number) {
  // Check cache first
  if (lookupCache[number]) {
    showLookupPreview(lookupCache[number]);
    return;
  }

  // Check if it's a known tenant or device contact
  const isKnownTenant = tenantsList.some(t => (t.phone || '').replace(/\D/g, '').includes(number));
  const isKnownContact = deviceContacts.some(c => (c.phone || '').replace(/\D/g, '').includes(number));
  if (isKnownTenant || isKnownContact) {
    hideLookupPreview();
    return;
  }

  // Call server API
  if (window.CallGuardNative && window.CallGuardNative.lookupNumber) {
    try {
      const raw = window.CallGuardNative.lookupNumber(number);
      const data = JSON.parse(raw || '{}');
      if (data.ok !== false) {
        lookupCache[number] = data;
        showLookupPreview(data);
      }
    } catch (e) {
      console.error('Lookup failed', e);
    }
  }
}

function showLookupPreview(data) {
  let container = document.getElementById('lookupPreview');
  if (!container) {
    container = document.createElement('div');
    container.id = 'lookupPreview';
    container.className = 'lookup-preview';
    const dialerSection = document.getElementById('dialerMatches');
    dialerSection.parentNode.insertBefore(container, dialerSection.nextSibling);
  }

  const spamClass = data.isSpam ? 'lookup-spam' : 'lookup-safe';
  const spamIcon = data.isSpam ? '⚠️' : '🛡️';
  const spamText = data.isSpam
    ? `SPAM · ${data.category || 'Desconocido'} (${data.spamReports || 0} reportes)`
    : (data.category || 'Número Limpio');

  const avatarHtml = data.avatarUrl
    ? `<img src="${data.avatarUrl}" class="lookup-avatar-img" onerror="this.style.display='none'">`
    : `<div class="lookup-avatar-letter">${(data.name || '#').substring(0, 1).toUpperCase()}</div>`;

  container.innerHTML = `
    <div class="lookup-card ${spamClass}">
      <div class="lookup-header">
        ${avatarHtml}
        <div class="lookup-info">
          <div class="lookup-name">${data.name || 'Desconocido'}</div>
          <div class="lookup-carrier">${data.carrier || ''} · ${data.city || 'Colombia'}</div>
        </div>
      </div>
      <div class="lookup-badge">
        <span>${spamIcon} ${spamText}</span>
        ${data.spamScore > 0 ? `<span class="lookup-score">Score: ${data.spamScore}/100</span>` : ''}
      </div>
    </div>
  `;
  container.classList.remove('hidden');
}

function hideLookupPreview() {
  const container = document.getElementById('lookupPreview');
  if (container) container.classList.add('hidden');
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

  // Search tenants
  const tenantMatches = (tenantsList || []).filter(t => {
    const p = (t.phone || '').replace(/\D/g, '');
    const n = (t.name || '').toLowerCase();
    return p.includes(query) || n.includes(dialNumber.toLowerCase());
  }).slice(0, 2).map(m => ({ ...m, source: 'laujim' }));

  // Search device contacts
  const deviceMatches = (deviceContacts || []).filter(c => {
    const p = (c.phone || '').replace(/\D/g, '');
    const n = (c.name || '').toLowerCase();
    return p.includes(query) || n.includes(dialNumber.toLowerCase());
  }).slice(0, 2).map(m => ({ ...m, source: 'device' }));

  const matches = [...tenantMatches, ...deviceMatches].slice(0, 3);

  if (matches.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.innerHTML = matches.map(m => {
    const badge = m.source === 'laujim'
      ? `<span class="match-apt">Apto ${m.apartment}</span>`
      : `<span class="match-apt" style="background:#1E40AF;">📱 Contacto</span>`;
    return `
    <div class="match-item">
      <div class="match-left" onclick="selectMatch('${m.phone}')">
        <div class="match-avatar">${(m.name || 'I').substring(0, 1).toUpperCase()}</div>
        <div>
          <div style="display:flex;align-items:center;">
            <span class="match-name">${m.name}</span>
            ${badge}
          </div>
          <div style="font-size:11px;color:#94A3B8;margin-top:1px;">${m.phone}</div>
        </div>
      </div>
      <div class="match-actions">
        <button class="action-btn-call" style="width:32px;height:32px;" onclick="makeCall('${m.phone}')" title="Llamar">📞</button>
      </div>
    </div>
  `;
  }).join('');
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
        renderHistory();
      }

      // Load device contacts
      if (window.CallGuardNative.getDeviceContacts) {
        try {
          const dcRaw = window.CallGuardNative.getDeviceContacts();
          deviceContacts = JSON.parse(dcRaw || '[]');
        } catch (e) {
          deviceContacts = [];
        }
      }

      const blockedRaw = window.CallGuardNative.getBlockedCalls();
      blockedList = JSON.parse(blockedRaw || '[]');
      updateBlockedBadge();
      renderHistory();
    } catch (e) {
      console.error('Error loading native data', e);
      renderHistory();
      updateStatusDisplay({ isDefaultDialer: false, roleGranted: true, allowedCount: 2 });
    }
  } else {
    // Simulated in browser for testing
    tenantsList = [
      { id: 1, name: 'Jim Carlos Varela', apartment: '101', phone: '3001234567' },
      { id: 2, name: 'Ana Gomez', apartment: '201', phone: '3109876543' }
    ];
    deviceContacts = [
      { name: 'Mamá', phone: '3001112233', isLocal: true },
      { name: 'Trabajo', phone: '6053456789', isLocal: true }
    ];
    renderHistory();
    updateStatusDisplay({ isDefaultDialer: false, roleGranted: true, allowedCount: 2 });
  }
}

function updateStatusDisplay(status) {
  const dot = document.getElementById('dbStatusDot');
  if (dot) dot.className = 'status-indicator ' + (status.roleGranted ? 'connected' : 'loading');

  const banner = document.getElementById('bannerDefaultDialer');
  if (banner) {
    if (status.isDefaultDialer) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  }

  const dialerDesc = document.getElementById('defaultDialerStatusDesc');
  if (dialerDesc) {
    dialerDesc.textContent = status.isDefaultDialer
      ? 'Predeterminada para llamadas'
      : 'No predeterminada · Toca para asignar';
  }

  const roleDesc = document.getElementById('roleStatusDesc');
  if (roleDesc) {
    roleDesc.textContent = status.roleGranted
      ? 'Filtro activo 24/7'
      : 'Permiso no otorgado';
  }
}

function handleSync() {
  const dot = document.getElementById('dbStatusDot');
  if (dot) dot.className = 'status-indicator loading';

  if (window.CallGuardNative && window.CallGuardNative.syncWithServer) {
    const resRaw = window.CallGuardNative.syncWithServer();
    try {
      const res = JSON.parse(resRaw);
      if (res.ok) {
        setTimeout(loadData, 300);
      }
    } catch (e) {}
  }
}

function filterContacts() {
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;

  const tenantBadge = document.getElementById('tenantChipBadge');
  if (tenantBadge) tenantBadge.textContent = tenantsList.length;

  const blockedBadge = document.getElementById('blockedChipBadge');
  if (blockedBadge) {
    blockedBadge.textContent = blockedList.length;
    if (blockedList.length > 0) blockedBadge.classList.remove('hidden');
    else blockedBadge.classList.add('hidden');
  }

  let items = [];

  if (activeFilter === 'all' || activeFilter === 'tenants') {
    (tenantsList || []).forEach(t => {
      items.push({
        type: 'tenant',
        name: t.name || 'Inquilino',
        phone: t.phone || '',
        sub: `Apto ${t.apartment || ''}`,
        isTenant: true,
        photo: t.photo || null,
        initial: (t.name || 'I').substring(0, 1).toUpperCase()
      });
    });
  }

  if (activeFilter === 'all') {
    (deviceContacts || []).forEach(c => {
      items.push({
        type: 'device',
        name: c.name || 'Contacto',
        phone: c.phone || '',
        sub: 'Contacto',
        isTenant: false,
        photo: null,
        initial: (c.name || 'C').substring(0, 1).toUpperCase()
      });
    });
  }

  if (activeFilter === 'all' || activeFilter === 'blocked' || activeFilter === 'missed') {
    (blockedList || []).forEach(b => {
      items.push({
        type: 'blocked',
        name: b.name || 'Llamada no deseada',
        phone: b.phone || '',
        sub: b.category === 'fraud' ? 'Sospecha fraude' : 'Spam',
        isBlocked: true,
        photo: null,
        initial: '⚠️'
      });
    });
  }

  const query = (document.getElementById('contactSearch')?.value || '').toLowerCase().trim();
  if (query) {
    items = items.filter(i => (i.name || '').toLowerCase().includes(query) || (i.phone || '').includes(query) || (i.sub && i.sub.toLowerCase().includes(query)));
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No hay llamadas o contactos registrados.</div>';
    return;
  }

  container.innerHTML = items.map(item => {
    const isSpam = item.type === 'blocked';
    const avatarContent = item.photo
      ? `<img src="${item.photo}" class="call-avatar-img">`
      : `<div class="call-avatar ${isSpam ? 'avatar-spam' : (item.isTenant ? 'avatar-tenant' : 'avatar-local')}">${item.initial}</div>`;

    const subBadge = item.isTenant
      ? `<span class="badge-tenant">${item.sub}</span>`
      : (isSpam ? `<span class="badge-spam">${item.sub}</span>` : `<span class="badge-sub">${item.sub}</span>`);

    return `
      <div class="call-card ${isSpam ? 'card-spam' : ''}">
        <div class="call-card-left" onclick="selectMatch('${item.phone}')">
          ${avatarContent}
          <div class="call-info">
            <div class="call-name-row">
              <span class="call-name">${item.name}</span>
              ${subBadge}
            </div>
            <div class="call-meta">
              <svg class="call-dir-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3"/>
              </svg>
              <span>${formatPhone(item.phone)}</span>
            </div>
          </div>
        </div>
        <div class="call-actions">
          <button class="call-action-btn" onclick="makeCall('${item.phone}')" title="Llamar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.72 11.72 0 003.68.59 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.72 11.72 0 00.59 3.68 1 1 0 01-.24 1.02l-2.23 2.09z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
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

function updateSettingsView() {
  // Update settings view
}
