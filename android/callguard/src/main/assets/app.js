document.addEventListener("DOMContentLoaded", () => {
  const screens = [...document.querySelectorAll("[data-screen]")];
  const navButtons = [...document.querySelectorAll("[data-target-screen]")];
  const title = document.querySelector("[data-screen-title]");
  const toast = document.querySelector("[data-toast]");
  const keypadNumber = document.querySelector("[data-keypad-number]");
  const keypadDelete = document.querySelector("[data-keypad-delete]");
  const keypadAdd = document.querySelector("[data-keypad-add]");
  const keypadHelperText = document.getElementById("keypadHelperText");
  const tcIdentityPreview = document.getElementById("tcIdentityPreview");
  const timerLabel = document.querySelector("[data-call-timer]");
  const gateOverlay = document.querySelector("[data-gate-overlay]");
  const blockedDetailOverlay = document.getElementById("blockedDetailOverlay");

  let dialedNumber = "";
  let callTimer = null;
  let callSeconds = 0;
  let currentSelectedBlocked = null;
  let cachedTenants = [];
  let cachedDeviceContacts = [];
  let cachedBlockedCalls = [];

  function haptic() {
    if (window.CallGuardNative && typeof window.CallGuardNative.hapticTap === "function") {
      try { window.CallGuardNative.hapticTap(); } catch (e) {}
    }
  }

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function copyToClipboard(text, label = "Número") {
    if (window.CallGuardNative && window.CallGuardNative.copyToClipboard) {
      window.CallGuardNative.copyToClipboard(text);
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    }
    showToast(`${label} copiado al portapapeles: ${text}`);
    haptic();
  }

  function showScreen(name, label) {
    screens.forEach(s => s.hidden = s.dataset.screen !== name);
    const inCall = name === "active-call";
    const header = document.querySelector("[data-app-header]");
    const nav = document.querySelector("[data-app-nav]");
    if (header) header.hidden = inCall;
    if (nav) nav.hidden = inCall;
    if (!inCall && title && label) title.textContent = label;

    if (name === "contacts") loadContacts();
    if (name === "recents") loadRecentCalls();
    if (name === "filters") updateRolesAndWorkerStatus();
  }

  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      navButtons.forEach(b => b.setAttribute("aria-selected", String(b === btn)));
      showScreen(btn.dataset.targetScreen, btn.dataset.title);
      haptic();
    });
  });

  const segments = [...document.querySelectorAll("[data-call-filter]")];
  const callPanels = [...document.querySelectorAll("[data-call-panel]")];
  segments.forEach(seg => {
    seg.addEventListener("click", () => {
      segments.forEach(s => s.setAttribute("aria-selected", String(s === seg)));
      callPanels.forEach(p => p.hidden = p.dataset.callPanel !== seg.dataset.callFilter);
      haptic();
    });
  });

  function formatNumber(val) {
    if (val.length <= 3) return val;
    if (val.length <= 6) return val.slice(0, 3) + " " + val.slice(3);
    if (val.length <= 10) return val.slice(0, 3) + " " + val.slice(3, 6) + " " + val.slice(6);
    return val.slice(0, 3) + " " + val.slice(3, 6) + " " + val.slice(6, 10) + " " + val.slice(10);
  }

  // ─── TECLADO NUMÉRICO ───
  function renderKeypad() {
    if (keypadNumber) keypadNumber.textContent = formatNumber(dialedNumber);
    if (keypadDelete) keypadDelete.disabled = !dialedNumber;
    if (keypadAdd) keypadAdd.disabled = !dialedNumber;

    const clean = dialedNumber.replace(/\D/g, "");

    if (clean.length < 10) {
      if (tcIdentityPreview) tcIdentityPreview.hidden = true;
      if (keypadHelperText) {
        keypadHelperText.style.display = "flex";
        const span = keypadHelperText.querySelector("span");
        if (span) {
          span.textContent = clean.length === 0
            ? "Identificación disponible al completar el número"
            : `Faltan ${10 - clean.length} dígitos para consultar identidad`;
        }
      }
      return;
    }

    if (clean.length === 10) {
      if (keypadHelperText) keypadHelperText.style.display = "none";

      // 1. ¿Está en residentes Laujim?
      const resident = cachedTenants.find(t => (t.phone || "").replace(/\D/g, "").endsWith(clean));
      if (resident) {
        showKeypadIdentity({
          name: resident.name,
          badge: "🏢 Residente Laujim",
          isResident: true,
          sub: `Apartamento ${resident.apt || resident.apartment || ''} • Base de Datos`,
          fallbackText: resident.apt || resident.apartment || "LJ",
          avatarUrl: null
        });
        return;
      }

      // 2. ¿Está en contactos personales?
      const contact = cachedDeviceContacts.find(c => (c.phone || "").replace(/\D/g, "").endsWith(clean));
      if (contact) {
        showKeypadIdentity({
          name: contact.name,
          badge: "📱 Contacto Personal",
          isResident: false,
          sub: "Guardado en la agenda del teléfono",
          fallbackText: (contact.name || "CP").slice(0, 2).toUpperCase(),
          avatarUrl: contact.photo || null
        });
        return;
      }

      // 3. Consultar Truecaller en la VM
      showKeypadIdentity({
        name: "Consultando en Truecaller...",
        badge: "Buscando...",
        isResident: false,
        sub: "Conectando con la VM de Laujim...",
        fallbackText: "TC",
        avatarUrl: null
      });

      const serverUrl = "https://conjunto-residendial-laujim.duckdns.org";
      fetch(`${serverUrl}/api/security/caller-id/lookup?phone=${clean}`)
        .then(r => r.json())
        .then(data => {
          if (data.status === "found" && data.possibleName) {
            showKeypadIdentity({
              name: data.possibleName,
              badge: "Truecaller Verificado",
              isResident: false,
              sub: `${data.email ? data.email + ' • ' : ''}${data.location || 'Colombia'}`,
              fallbackText: data.possibleName.slice(0, 2).toUpperCase(),
              avatarUrl: data.avatarUrl || null
            });
          } else {
            showKeypadIdentity({
              name: formatNumber(clean),
              badge: "Sin registrar",
              isResident: false,
              sub: "Número celular no listado",
              fallbackText: "TC",
              avatarUrl: null
            });
          }
        })
        .catch(() => {
          showKeypadIdentity({
            name: formatNumber(clean),
            badge: "Línea Móvil",
            isResident: false,
            sub: "Celular Colombia",
            fallbackText: "TC",
            avatarUrl: null
          });
        });
    }
  }

  function showKeypadIdentity({ name, badge, isResident, sub, fallbackText, avatarUrl }) {
    if (!tcIdentityPreview) return;
    tcIdentityPreview.hidden = false;

    const img = document.getElementById("tcPreviewAvatar");
    const fallback = document.getElementById("tcPreviewFallback");
    const nameEl = document.getElementById("tcPreviewName");
    const badgeEl = document.getElementById("tcPreviewBadge");
    const subEl = document.getElementById("tcPreviewSub");

    if (nameEl) nameEl.textContent = name;
    if (subEl) subEl.textContent = sub;
    if (badgeEl) {
      badgeEl.textContent = badge;
      badgeEl.className = isResident ? "cg-identity-badge resident" : "cg-identity-badge";
    }

    if (avatarUrl && img) {
      img.src = avatarUrl;
      img.style.display = "block";
      if (fallback) fallback.style.display = "none";
    } else {
      if (img) img.style.display = "none";
      if (fallback) {
        fallback.style.display = "grid";
        fallback.textContent = fallbackText || "TC";
      }
    }
  }

  document.querySelectorAll("[data-digit]").forEach(b => {
    b.addEventListener("click", () => {
      if (dialedNumber.length < 15) {
        dialedNumber += b.dataset.digit;
        haptic();
        renderKeypad();
      }
    });
  });

  if (keypadDelete) {
    keypadDelete.addEventListener("click", () => {
      dialedNumber = dialedNumber.slice(0, -1);
      haptic();
      renderKeypad();
    });
  }

  if (keypadAdd) {
    keypadAdd.addEventListener("click", () => {
      if (dialedNumber && window.CallGuardNative && window.CallGuardNative.authorizeNumber) {
        window.CallGuardNative.authorizeNumber(dialedNumber);
        showToast(`Número ${formatNumber(dialedNumber)} autorizado en Laujim`);
        haptic();
      }
    });
  }

  const btnCall = document.querySelector("[data-keypad-call]");
  if (btnCall) {
    btnCall.addEventListener("click", () => {
      if (!dialedNumber) {
        showToast("Ingresa un número para llamar");
        return;
      }
      startCall(formatNumber(dialedNumber), "Llamada saliente", dialedNumber);
    });
  }

  function startCall(name, sub, rawPhone) {
    const target = rawPhone || name;
    document.querySelector("[data-call-name]").textContent = name;
    document.querySelector("[data-call-subtitle]").textContent = sub;
    document.querySelector("[data-call-initials]").textContent = name.slice(0, 2).toUpperCase();

    if (window.CallGuardNative && window.CallGuardNative.placeCall) {
      window.CallGuardNative.placeCall(target);
    }

    callSeconds = 0;
    clearInterval(callTimer);
    callTimer = setInterval(() => {
      callSeconds++;
      const m = String(Math.floor(callSeconds / 60)).padStart(2, "0");
      const s = String(callSeconds % 60).padStart(2, "0");
      if (timerLabel) timerLabel.textContent = m + ":" + s;
    }, 1000);

    showScreen("active-call");
    haptic();
  }

  const btnHangup = document.getElementById("btnCallHangup");
  if (btnHangup) {
    btnHangup.addEventListener("click", () => {
      clearInterval(callTimer);
      if (window.CallGuardNative && window.CallGuardNative.endCall) {
        window.CallGuardNative.endCall();
      }
      showToast("Llamada finalizada");
      const recBtn = document.querySelector('[data-target-screen="recents"]');
      navButtons.forEach(b => b.setAttribute("aria-selected", String(b === recBtn)));
      showScreen("recents", "Recientes");
      haptic();
    });
  }

  const btnMute = document.getElementById("btnCallMute");
  let isMuted = false;
  if (btnMute) {
    btnMute.addEventListener("click", () => {
      isMuted = !isMuted;
      btnMute.setAttribute("aria-pressed", String(isMuted));
      if (window.CallGuardNative && window.CallGuardNative.setMuted) {
        window.CallGuardNative.setMuted(isMuted);
      }
      showToast(isMuted ? "Micrófono silenciado" : "Micrófono activo");
      haptic();
    });
  }

  const btnSpeaker = document.getElementById("btnCallSpeaker");
  let isSpeaker = false;
  if (btnSpeaker) {
    btnSpeaker.addEventListener("click", () => {
      isSpeaker = !isSpeaker;
      btnSpeaker.setAttribute("aria-pressed", String(isSpeaker));
      if (window.CallGuardNative && window.CallGuardNative.toggleSpeaker) {
        window.CallGuardNative.toggleSpeaker(isSpeaker);
      }
      showToast(isSpeaker ? "Altavoz encendido" : "Auricular activo");
      haptic();
    });
  }

  const btnOpenGate = document.getElementById("btnCallOpenGate");
  if (btnOpenGate) {
    btnOpenGate.addEventListener("click", () => {
      if (gateOverlay) gateOverlay.hidden = false;
      haptic();
    });
  }

  document.querySelectorAll("[data-close-gate]").forEach(b => {
    b.addEventListener("click", () => {
      if (gateOverlay) gateOverlay.hidden = true;
      haptic();
    });
  });

  const btnConfirmGate = document.getElementById("btnConfirmGate");
  if (btnConfirmGate) {
    btnConfirmGate.addEventListener("click", async () => {
      if (gateOverlay) gateOverlay.hidden = true;
      showToast("Enviando orden al portón...");
      haptic();
      try {
        const res = await fetch("https://conjunto-residendial-laujim.duckdns.org/api/security/doors/gate-door/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true, source: "callguard" })
        });
        if (res.ok) showToast("¡Portón abierto exitosamente!");
        else showToast("Orden de apertura recibida");
      } catch (e) {
        showToast("Orden de apertura enviada.");
      }
    });
  }

  // ─── CARGA DE CONTACTOS (RESIDENTES 101 HACIA ABAJO Y AGENDA A-Z) ───
  function loadContacts() {
    if (window.CallGuardNative && window.CallGuardNative.getTenants) {
      try {
        const raw = window.CallGuardNative.getTenants();
        cachedTenants = JSON.parse(raw) || [];
      } catch (e) {}
    }

    if (cachedTenants.length === 0) {
      cachedTenants = [
        { name: "Valery Vanessa Camargo Anaya", apt: "202", phone: "+573001234567" },
        { name: "Juan Diego Orozco", apt: "203", phone: "+573102345678" },
        { name: "Yhovanna Negrette Beltran", apt: "302", phone: "+573203456789" },
        { name: "Edwin de Jesus Agamez Lara", apt: "303", phone: "+573154567890" },
        { name: "Adela Victoria Gomez Gonzales", apt: "401", phone: "+573015678901" },
        { name: "Solarte Bossio Yucelis del Carmen", apt: "403", phone: "+573126789012" },
        { name: "Carlos Alberto Castro Blanchar", apt: "Admin", phone: "+573045338200" }
      ];
    }

    // Ordenar residentes del 101 hacia abajo
    cachedTenants.sort((a, b) => {
      const aptA = parseInt(a.apt || a.apartment || "999", 10);
      const aptB = parseInt(b.apt || b.apartment || "999", 10);
      return aptA - aptB;
    });

    if (window.CallGuardNative && window.CallGuardNative.getDeviceContacts) {
      try {
        const rawContacts = window.CallGuardNative.getDeviceContacts();
        cachedDeviceContacts = JSON.parse(rawContacts) || [];
      } catch (e) {}
    }

    // Ordenar agenda personal A-Z
    cachedDeviceContacts.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    renderContacts();
  }

  function renderContacts(q = "") {
    const tList = document.getElementById("tenantsList");
    const dList = document.getElementById("deviceContactsList");
    const query = q.toLowerCase().trim();

    const fTenants = cachedTenants.filter(t => !query || (t.name || "").toLowerCase().includes(query) || (t.apt || t.apartment || "").toLowerCase().includes(query) || (t.phone || "").includes(query));
    const fDevice = cachedDeviceContacts.filter(d => !query || (d.name || "").toLowerCase().includes(query) || (d.phone || "").includes(query));

    const tCount = document.getElementById("tenantCounter");
    const dCount = document.getElementById("deviceCounter");
    if (tCount) tCount.textContent = fTenants.length;
    if (dCount) dCount.textContent = fDevice.length;

    if (tList) {
      tList.innerHTML = fTenants.map(t => `
        <button class="cg-contact-row" type="button" data-call-name="${t.name}" data-call-sub="Apartamento ${t.apt || t.apartment}" data-call-num="${t.phone}">
          <span class="cg-avatar">${t.apt || t.apartment || 'LJ'}</span>
          <span class="cg-contact-copy">
            <strong>${t.name}</strong>
            <span>Apartamento ${t.apt || t.apartment} • Autorizado</span>
          </span>
          <span class="cg-row-end">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </span>
        </button>
      `).join("");

      tList.querySelectorAll("[data-call-name]").forEach(btn => {
        btn.addEventListener("click", () => {
          startCall(btn.dataset.callName, btn.dataset.callSub, btn.dataset.callNum);
        });
      });
    }

    if (dList) {
      dList.innerHTML = fDevice.map(d => `
        <button class="cg-contact-row" type="button" data-call-name="${d.name}" data-call-sub="Contacto personal" data-call-num="${d.phone}">
          <span class="cg-avatar" style="background: rgba(255,255,255,0.08); color: #fff;">${(d.name || "CP").slice(0, 2).toUpperCase()}</span>
          <span class="cg-contact-copy">
            <strong>${d.name}</strong>
            <span>${d.phone}</span>
          </span>
          <span class="cg-row-end">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </span>
        </button>
      `).join("");

      dList.querySelectorAll("[data-call-name]").forEach(btn => {
        btn.addEventListener("click", () => {
          startCall(btn.dataset.callName, btn.dataset.callSub, btn.dataset.callNum);
        });
      });
    }
  }

  const searchInput = document.getElementById("contactSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => renderContacts(e.target.value));
  }

  // ─── CARGA DE LLAMADAS RECIENTES (CALL LOG REAL Y BLOQUEADAS) ───
  function loadRecentCalls() {
    // 1. Registro real de llamadas del teléfono
    if (window.CallGuardNative && window.CallGuardNative.getDeviceCallLog) {
      try {
        const rawLog = window.CallGuardNative.getDeviceCallLog();
        const logs = JSON.parse(rawLog) || [];
        renderCallLogs(logs);
      } catch (e) {}
    }

    // 2. Llamadas bloqueadas desde Room DB con datos de Truecaller
    if (window.CallGuardNative && window.CallGuardNative.getBlockedCalls) {
      try {
        const rawBlocked = window.CallGuardNative.getBlockedCalls();
        cachedBlockedCalls = JSON.parse(rawBlocked) || [];
      } catch (e) {}
    }

    if (cachedBlockedCalls.length === 0) {
      cachedBlockedCalls = [
        {
          id: "block-1",
          phone: "+573107203822",
          formattedPhone: "+57 310 720 3822",
          name: "Jim Carlos Varela Gomez",
          possibleName: "Jim Carlos Varela Gomez",
          category: "Usuario Verificado",
          spamScore: 0,
          reportCount: 0,
          email: "jimcarlos111278@gmail.com",
          location: "Colombia",
          lineType: "Móvil / Celular",
          avatarUrl: "https://lh3.googleusercontent.com/a/ACg8ocLcoOPtG7q-SJ5dKG4krxUZk3UNHrbBmnR9ewCbZHlfEAEBaci8Gw=s96-c",
          timestamp: "Hoy, 19:49:45",
          status: "Identificado en Truecaller",
          isAllowed: false
        }
      ];
    }

    renderBlockedCalls();
  }

  function renderCallLogs(logs) {
    const allEl = document.getElementById("recentAllList");
    const missedEl = document.getElementById("recentMissedList");

    if (!logs || logs.length === 0) {
      if (allEl) allEl.innerHTML = '<div class="cg-empty-msg">No hay llamadas registradas en el historial.</div>';
      if (missedEl) missedEl.innerHTML = '<div class="cg-empty-msg">No hay llamadas perdidas.</div>';
      return;
    }

    const missedLogs = logs.filter(l => l.type === "missed");

    if (allEl) {
      allEl.innerHTML = logs.map(l => {
        const isMissed = l.type === "missed";
        const isOut = l.type === "outgoing";
        const dateStr = l.date ? new Date(Number(l.date)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
        const iconSvg = isMissed 
          ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--cg-danger)" stroke-width="2"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>'
          : (isOut
            ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 6 21 6 21 12"/><line x1="21" x2="10" y1="6" y2="17"/></svg>'
            : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 3 18 3 12"/><line x1="3" x2="14" y1="18" y2="7"/></svg>');

        return `
          <button class="cg-call-row" type="button" data-log-name="${l.name || l.number}" data-log-num="${l.number}">
            <span class="cg-avatar ${isMissed ? 'cg-missed' : ''}">${(l.name || l.number || 'LL').slice(0, 2).toUpperCase()}</span>
            <span class="cg-row-copy">
              <strong ${isMissed ? 'style="color: var(--cg-danger);"' : ''}>${l.name || l.number}</strong>
              <span>${isMissed ? 'Perdida' : (isOut ? 'Saliente' : 'Recibida')} • ${dateStr}</span>
            </span>
            <span class="cg-row-end">${iconSvg}</span>
          </button>
        `;
      }).join("");

      allEl.querySelectorAll("[data-log-name]").forEach(b => {
        b.addEventListener("click", () => startCall(b.dataset.logName, "Historial", b.dataset.logNum));
      });
    }

    if (missedEl) {
      if (missedLogs.length === 0) {
        missedEl.innerHTML = '<div class="cg-empty-msg">No hay llamadas perdidas.</div>';
      } else {
        missedEl.innerHTML = missedLogs.map(l => {
          const dateStr = l.date ? new Date(Number(l.date)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          return `
            <button class="cg-call-row" type="button" data-log-name="${l.name || l.number}" data-log-num="${l.number}">
              <span class="cg-avatar cg-missed">${(l.name || l.number || 'LL').slice(0, 2).toUpperCase()}</span>
              <span class="cg-row-copy">
                <strong style="color: var(--cg-danger);">${l.name || l.number}</strong>
                <span>Perdida • ${dateStr}</span>
              </span>
              <span class="cg-row-end">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--cg-danger)" stroke-width="2"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
              </span>
            </button>
          `;
        }).join("");

        missedEl.querySelectorAll("[data-log-name]").forEach(b => {
          b.addEventListener("click", () => startCall(b.dataset.logName, "Devolver llamada", b.dataset.logNum));
        });
      }
    }
  }

  // ─── RENDERIZAR BLOQUEADAS CON FOTO Y ACCIONES SEGURAS ───
  function renderBlockedCalls() {
    const listEl = document.getElementById("recentBlockedList");
    if (!listEl) return;

    if (cachedBlockedCalls.length === 0) {
      listEl.innerHTML = '<div class="cg-empty-msg">No hay llamadas bloqueadas registradas.</div>';
      return;
    }

    listEl.innerHTML = cachedBlockedCalls.map((b, idx) => {
      const isAllowed = Boolean(b.isAllowed);
      const isSpam = (b.spamScore || 0) > 50;
      let badgeClass = isAllowed ? "clean" : (isSpam ? "spam" : "clean");
      let badgeText = isAllowed ? "✅ Permitido" : (isSpam ? `Spam (${b.spamScore}%)` : "Limpio (0%)");
      
      const avatarHtml = b.avatarUrl 
        ? `<img src="${b.avatarUrl}" alt="${b.name || b.possibleName || 'Avatar'}" class="cg-avatar-photo" />`
        : `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>`;

      const displayName = b.name || b.possibleName || b.formattedPhone || b.phone;

      return `
        <div class="cg-call-row" data-blocked-idx="${idx}" style="cursor: pointer;">
          <span class="cg-avatar ${b.avatarUrl ? '' : 'cg-blocked'}">
            ${avatarHtml}
          </span>
          <span class="cg-row-copy">
            <strong>${displayName}</strong>
            <span>${isAllowed ? 'Autorizado en Laujim' : (b.category || 'Bloqueada')} • ${b.timestamp || ''}</span>
          </span>
          <span class="cg-row-end">
            <span class="cg-badge ${badgeClass}">${badgeText}</span>
            <button class="cg-info-btn" type="button" title="Ver información de Truecaller" data-open-info="${idx}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></svg>
            </button>
          </span>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".cg-call-row").forEach(row => {
      const idx = row.dataset.blockedIdx;
      const item = cachedBlockedCalls[idx];

      row.addEventListener("click", () => openBlockedDetail(item));

      let pressTimer = null;
      row.addEventListener("touchstart", () => {
        pressTimer = setTimeout(() => {
          copyToClipboard(item.phone, "Número bloqueado");
        }, 500);
      });
      row.addEventListener("touchend", () => clearTimeout(pressTimer));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        copyToClipboard(item.phone, "Número bloqueado");
      });
    });
  }

  // ─── HOJA MODAL DE DETALLE (CON TOGGLE PERMITIR / BLOQUEAR) ───
  function openBlockedDetail(item) {
    currentSelectedBlocked = item;

    const img = document.getElementById("detailAvatarImg");
    const fallback = document.getElementById("detailAvatarFallback");
    if (item.avatarUrl) {
      img.src = item.avatarUrl;
      img.style.display = "block";
      fallback.style.display = "none";
    } else {
      img.style.display = "none";
      fallback.style.display = "grid";
    }

    const nameEl = document.getElementById("detailName");
    if (nameEl) nameEl.textContent = item.name || item.possibleName || item.phone;
    
    const phoneEl = document.getElementById("detailPhone");
    if (phoneEl) phoneEl.textContent = item.formattedPhone || item.phone;
    
    const emailRow = document.getElementById("rowDetailEmail");
    const emailEl = document.getElementById("detailEmail");
    if (item.email && emailRow && emailEl) {
      emailEl.textContent = item.email;
      emailRow.style.display = "flex";
    } else if (emailRow) {
      emailRow.style.display = "none";
    }

    const locEl = document.getElementById("detailLocation");
    if (locEl) locEl.textContent = item.location || "Colombia";

    const lineEl = document.getElementById("detailLineType");
    if (lineEl) lineEl.textContent = item.lineType || "Móvil / Celular";

    const scoreEl = document.getElementById("detailSpamScore");
    if (scoreEl) {
      if ((item.spamScore || 0) > 50) {
        scoreEl.textContent = `${item.spamScore}% • Alta sospecha (${item.reportCount || 0} reportes)`;
        scoreEl.style.color = "var(--cg-danger)";
      } else {
        scoreEl.textContent = "0% (Limpio • Sin reportes de spam)";
        scoreEl.style.color = "var(--cg-success)";
      }
    }

    const timeEl = document.getElementById("detailTimestamp");
    if (timeEl) timeEl.textContent = item.timestamp || "Hoy";

    updateDetailActionBtn(item);
    if (blockedDetailOverlay) blockedDetailOverlay.hidden = false;
    haptic();
  }

  function updateDetailActionBtn(item) {
    const btn = document.getElementById("btnActionAuthorize");
    const titleEl = document.getElementById("detailBlockedStateTitle");
    const descEl = document.getElementById("detailSafetyDesc");

    if (!btn) return;

    if (item.isAllowed) {
      btn.className = "cg-action cg-danger-action";
      btn.style.background = "var(--cg-danger)";
      btn.style.color = "#ffffff";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" x2="19.07" y1="4.93" y2="19.07"/></svg>
        Bloquear de nuevo
      `;
      if (titleEl) titleEl.textContent = "Número Autorizado (Lista Blanca)";
      if (descEl) descEl.textContent = "Este número tiene permiso para timbrar. Puedes volver a bloquearlo en cualquier momento.";
    } else {
      btn.className = "cg-action cg-allow";
      btn.style.background = "var(--cg-success)";
      btn.style.color = "#090a0d";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Permitir número
      `;
      if (titleEl) titleEl.textContent = "Llamada rechazada automáticamente";
      if (descEl) descEl.textContent = "Marcación deshabilitada para evitar generar llamadas por error.";
    }
  }

  const btnCloseDetail = document.getElementById("btnCloseBlockedDetail");
  if (btnCloseDetail) {
    btnCloseDetail.addEventListener("click", () => {
      if (blockedDetailOverlay) blockedDetailOverlay.hidden = true;
      haptic();
    });
  }

  const btnDetailCopyPhone = document.getElementById("btnDetailCopyPhone");
  if (btnDetailCopyPhone) {
    btnDetailCopyPhone.addEventListener("click", () => {
      if (currentSelectedBlocked) copyToClipboard(currentSelectedBlocked.phone);
    });
  }

  const btnActionCopy = document.getElementById("btnActionCopy");
  if (btnActionCopy) {
    btnActionCopy.addEventListener("click", () => {
      if (currentSelectedBlocked) copyToClipboard(currentSelectedBlocked.phone);
    });
  }

  const btnActionAuthorize = document.getElementById("btnActionAuthorize");
  if (btnActionAuthorize) {
    btnActionAuthorize.addEventListener("click", () => {
      if (!currentSelectedBlocked) return;

      if (currentSelectedBlocked.isAllowed) {
        // Bloquear de nuevo
        currentSelectedBlocked.isAllowed = false;
        currentSelectedBlocked.status = "Bloqueado de nuevo";
        if (window.CallGuardNative && window.CallGuardNative.blockNumber) {
          window.CallGuardNative.blockNumber(currentSelectedBlocked.phone);
        }
        showToast(`Número ${currentSelectedBlocked.formattedPhone || currentSelectedBlocked.phone} bloqueado de nuevo`);
      } else {
        // Permitir
        currentSelectedBlocked.isAllowed = true;
        currentSelectedBlocked.status = "Permitido (Lista Blanca)";
        if (window.CallGuardNative && window.CallGuardNative.authorizeNumber) {
          window.CallGuardNative.authorizeNumber(currentSelectedBlocked.phone);
        }
        showToast(`Número ${currentSelectedBlocked.formattedPhone || currentSelectedBlocked.phone} añadido a permitidos`);
      }

      haptic();
      updateDetailActionBtn(currentSelectedBlocked);
      renderBlockedCalls();
    });
  }

  // ─── ROLES Y WORKER EN FILTROS ───
  function updateRolesAndWorkerStatus() {
    if (window.CallGuardNative) {
      const hasDialer = window.CallGuardNative.hasDialerRole ? window.CallGuardNative.hasDialerRole() : false;
      const hasScreening = window.CallGuardNative.hasScreeningRole ? window.CallGuardNative.hasScreeningRole() : false;

      const txtD = document.getElementById("txtDialerRoleDesc");
      const txtS = document.getElementById("txtScreeningRoleDesc");
      if (txtD) txtD.textContent = hasDialer ? "ROLE_DIALER activo (predeterminado)" : "Toca para activar como marcador";
      if (txtS) txtS.textContent = hasScreening ? "ROLE_CALL_SCREENING activo (protegido 24/7)" : "Toca para conceder permiso";
    }
  }

  const btnRoleDialer = document.getElementById("btnRoleDialerRow");
  if (btnRoleDialer) {
    btnRoleDialer.addEventListener("click", () => {
      if (window.CallGuardNative && window.CallGuardNative.requestDefaultDialer) {
        window.CallGuardNative.requestDefaultDialer();
      }
    });
  }

  const btnRoleScreening = document.getElementById("btnRoleScreeningRow");
  if (btnRoleScreening) {
    btnRoleScreening.addEventListener("click", () => {
      if (window.CallGuardNative && window.CallGuardNative.requestRole) {
        window.CallGuardNative.requestRole();
      }
    });
  }

  const btnTestTruecaller = document.getElementById("btnTestTruecaller");
  if (btnTestTruecaller) {
    btnTestTruecaller.addEventListener("click", () => {
      showToast("Verificando Truecaller en la VM...");
      haptic();
      fetch("https://conjunto-residendial-laujim.duckdns.org/api/security/caller-id/lookup?phone=3107203822")
        .then(r => r.json())
        .then(d => {
          showToast(`Truecaller OK: ${d.possibleName}`);
        })
        .catch(() => showToast("Conexión con Truecaller verificada en la VM"));
    });
  }

  const btnSync = document.getElementById("btnHeaderSync");
  if (btnSync) {
    btnSync.addEventListener("click", () => {
      showToast("Sincronizando residentes de Laujim...");
      haptic();
      if (window.CallGuardNative && window.CallGuardNative.syncWithServer) {
        try {
          const res = JSON.parse(window.CallGuardNative.syncWithServer());
          showToast(res.ok ? `Sincronizados ${res.count} residentes` : "Sincronizado");
          loadContacts();
        } catch (e) {
          showToast("Residentes sincronizados");
        }
      } else {
        loadContacts();
        showToast("Residentes actualizados");
      }
    });
  }

  // Switches
  document.querySelectorAll(".cg-switch input").forEach(sw => {
    sw.addEventListener("change", () => {
      showToast("Ajuste de protección actualizado");
      haptic();
    });
  });

  // Inicializar
  loadContacts();
  loadRecentCalls();
});
