let currentTab = 'tabKeypad';
let dialNumber = '';
let tenantsList = [];
let blockedList = [];

// Init UI & Events
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupDialer();
  loadData();
  
  document.getElementById('btnSync').addEventListener('click', handleSync);
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.getElementById('btnClearBlocked').addEventListener('click', clearBlocked);
  document.getElementById('btnRequestRole').addEventListener('click', requestRole);
  document.getElementById('contactSearch').addEventListener('input', filterContacts);
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
      dialNumber += k.getAttribute('data-val');
      updateDialerDisplay();
    });
  });

  backspace.addEventListener('click', () => {
    dialNumber = dialNumber.slice(0, -1);
    updateDialerDisplay();
  });

  // Long press backspace to clear all
  let bsTimer = null;
  backspace.addEventListener('touchstart', () => {
    bsTimer = setTimeout(() => { dialNumber = ''; updateDialerDisplay(); }, 600);
  });
  backspace.addEventListener('touchend', () => clearTimeout(bsTimer));

  callBtn.addEventListener('click', () => {
    if (!dialNumber) return;
    makeCall(dialNumber);
  });
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
    return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
  }
  return num;
}

function searchDialerMatches() {
  const container = document.getElementById('dialerMatches');
  if (!dialNumber) {
    container.classList.add('hidden');
    return;
  }
  const query = dialNumber.toLowerCase();
  const matches = tenantsList.filter(t => 
    t.normalizedPhone.includes(query) || (t.name && t.name.toLowerCase().includes(query))
  ).slice(0, 3);

  if (matches.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.innerHTML = matches.map(m => `
    <div class="match-item" onclick="selectMatch('${m.phone}')">
      <div>
        <span class="match-name">${m.name}</span>
        <span class="match-apt">${m.apartment}</span>
      </div>
      <span style="font-size:11px;color:#94A3B8;">${m.phone}</span>
    </div>
  `).join('');
  container.classList.remove('hidden');
}

window.selectMatch = function(phone) {
  dialNumber = phone.replace(/\D/g, '');
  updateDialerDisplay();
  makeCall(dialNumber);
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

function authorizeNumber(number) {
  if (window.CallGuardNative && window.CallGuardNative.authorizeNumber) {
    window.CallGuardNative.authorizeNumber(number);
  }
  alert('Número ' + number + ' autorizado en la lista de confianza.');
  loadData();
}

async function loadData() {
  updateDbStatus('loading', 'Consultando DB...');
  
  // 1. Fetch tenants from server or native bridge
  try {
    const server = getServerUrl();
    const res = await fetch(server + '/api/callguard/tenants', { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      tenantsList = data.tenants || [];
      document.getElementById('tenantCountBadge').innerText = tenantsList.length;
      updateDbStatus('connected', '🟢 Conectado (' + tenantsList.length + ' Inquilinos)');
      
      // Sync with native store if bridge available
      if (window.CallGuardNative && window.CallGuardNative.syncWithServer) {
        window.CallGuardNative.syncWithServer();
      }
    } else {
      throw new Error('HTTP ' + res.status);
    }
  } catch (err) {
    updateDbStatus('error', '🔴 Error DB (' + (err.message || 'Offline') + ')');
  }

  // 2. Load blocked calls
  loadBlockedCalls();
}

function updateDbStatus(type, text) {
  const badge = document.getElementById('dbStatusBadge');
  const txt = document.getElementById('dbStatusText');
  badge.className = 'db-status ' + type;
  txt.innerText = text;
}

function getServerUrl() {
  const input = document.getElementById('txtServerUrl');
  return (input && input.value.trim()) || 'https://conjunto-residendial-laujim.duckdns.org';
}

async function loadBlockedCalls() {
  if (window.CallGuardNative && window.CallGuardNative.getBlockedCalls) {
    try {
      const raw = window.CallGuardNative.getBlockedCalls();
      blockedList = JSON.parse(raw);
    } catch {}
  } else {
    // Web mock/server fallback
    try {
      const res = await fetch(getServerUrl() + '/api/callguard/blocked-calls');
      if (res.ok) {
        const data = await res.json();
        blockedList = data.blockedCalls || [];
      }
    } catch {}
  }

  const badge = document.getElementById('blockedBadgeCount');
  if (blockedList.length > 0) {
    badge.innerText = blockedList.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (currentTab === 'tabBlocked') renderBlocked();
}

function renderBlocked() {
  const container = document.getElementById('blockedList');
  if (!blockedList || blockedList.length === 0) {
    container.innerHTML = '<div class="empty-state">No hay llamadas bloqueadas registradas.<br><span style="font-size:11px;opacity:0.7;">Cuando un número no autenticado llame, será rechazado en silencio.</span></div>';
    return;
  }

  container.innerHTML = blockedList.map(b => {
    const timeStr = b.timestamp ? new Date(b.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const dateStr = b.timestamp ? new Date(b.timestamp).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
    const isMobile = b.hasWhatsApp || (b.phone && b.phone.startsWith('3') && b.phone.length === 10);

    return `
      <div class="blocked-card">
        <div class="blocked-info">
          <div class="avatar blocked">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
            </svg>
            ${isMobile ? '<span class="wa-indicator" title="Tiene WhatsApp"></span>' : ''}
          </div>
          <div>
            <div class="name">${b.name || 'Número Desconocido'}</div>
            <div class="details">${b.phone} • ${dateStr} ${timeStr}</div>
            <span class="reason-tag">${b.reason || 'Bloqueado por CallGuard'}</span>
          </div>
        </div>
        <div class="card-actions">
          ${isMobile ? `
            <button class="btn-action btn-wa" onclick="openWhatsApp('${b.phone}')" title="Ver en WhatsApp">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-5.46-4.45-9.92-9.91-9.92z"/></svg>
            </button>
          ` : ''}
          <button class="btn-action btn-call" onclick="makeCall('${b.phone}')" title="Llamar">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.72 11.72 0 003.68.59 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.72 11.72 0 00.59 3.68 1 1 0 01-.24 1.02l-2.23 2.09z"/></svg>
          </button>
          <button class="btn-action btn-allow" onclick="authorizeNumber('${b.phone}')" title="Autorizar">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderContacts() {
  const container = document.getElementById('contactsList');
  if (!tenantsList || tenantsList.length === 0) {
    container.innerHTML = '<div class="empty-state">No hay inquilinos sincronizados.</div>';
    return;
  }

  container.innerHTML = tenantsList.map(t => `
    <div class="contact-card">
      <div class="contact-info">
        <div class="avatar">${t.name ? t.name.slice(0, 1).toUpperCase() : 'I'}</div>
        <div>
          <div class="name">${t.name}</div>
          <div class="details">${t.apartment} • ${t.phone}</div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn-action btn-wa" onclick="openWhatsApp('${t.phone}')" title="WhatsApp">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-5.46-4.45-9.92-9.91-9.92z"/></svg>
        </button>
        <button class="btn-action btn-call" onclick="makeCall('${t.phone}')" title="Llamar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.72 11.72 0 003.68.59 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.72 11.72 0 00.59 3.68 1 1 0 01-.24 1.02l-2.23 2.09z"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function filterContacts(e) {
  const query = e.target.value.toLowerCase().trim();
  const filtered = tenantsList.filter(t => 
    t.name.toLowerCase().includes(query) || t.phone.includes(query) || (t.apartment && t.apartment.toLowerCase().includes(query))
  );
  const container = document.getElementById('contactsList');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No se encontraron contactos coincidentes.</div>';
    return;
  }
  container.innerHTML = filtered.map(t => `
    <div class="contact-card">
      <div class="contact-info">
        <div class="avatar">${t.name ? t.name.slice(0, 1).toUpperCase() : 'I'}</div>
        <div>
          <div class="name">${t.name}</div>
          <div class="details">${t.apartment} • ${t.phone}</div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn-action btn-wa" onclick="openWhatsApp('${t.phone}')" title="WhatsApp">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-5.46-4.45-9.92-9.91-9.92z"/></svg>
        </button>
        <button class="btn-action btn-call" onclick="makeCall('${t.phone}')" title="Llamar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.72 11.72 0 003.68.59 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.72 11.72 0 00.59 3.68 1 1 0 01-.24 1.02l-2.23 2.09z"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function updateSettingsView() {
  if (window.CallGuardNative && window.CallGuardNative.getStatus) {
    try {
      const status = JSON.parse(window.CallGuardNative.getStatus());
      const desc = document.getElementById('roleStatusDesc');
      if (status.roleGranted) {
        desc.innerText = '🟢 Rol activo. Android filtra llamadas entrantes automáticamente.';
        document.getElementById('btnRequestRole').innerText = 'Permiso Activo';
        document.getElementById('btnRequestRole').disabled = true;
      } else {
        desc.innerText = '⚠️ El rol de Call Screening no ha sido concedido todavía.';
      }
    } catch {}
  }
}

function requestRole() {
  if (window.CallGuardNative && window.CallGuardNative.requestRole) {
    window.CallGuardNative.requestRole();
  } else {
    alert('Función disponible en la APK Android.');
  }
}

function handleSync() {
  const btn = document.getElementById('btnSync');
  btn.style.transform = 'rotate(180deg)';
  setTimeout(() => { btn.style.transform = ''; }, 600);
  loadData();
}

function clearBlocked() {
  if (!confirm('¿Deseas vaciar el historial de llamadas bloqueadas?')) return;
  blockedList = [];
  if (window.CallGuardNative && window.CallGuardNative.clearBlockedCalls) {
    window.CallGuardNative.clearBlockedCalls();
  }
  renderBlocked();
  document.getElementById('blockedBadgeCount').classList.add('hidden');
}

function saveSettings() {
  alert('Ajustes guardados correctamente.');
  loadData();
}
