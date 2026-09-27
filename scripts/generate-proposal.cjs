const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'design-proposals', 'whatsapp-cloud-fix-proposal.html');

const html = `<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Propuesta Visual - WhatsApp Cloud Fix Laujim</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --wa-bg-canvas: #0c1317;
      --wa-sidebar-bg: #111b21;
      --wa-header-bg: #202c33;
      --wa-bubble-in: #202c33;
      --wa-bubble-out: #005c4b;
      --wa-bubble-out-tail: #005c4b;
      --wa-bubble-in-tail: #202c33;
      --wa-green: #00a884;
      --wa-green-hover: #06cf9c;
      --wa-blue-check: #53bdeb;
      --wa-text-primary: #e9edef;
      --wa-text-secondary: #8696a0;
      --wa-border: #222d34;
      --wa-input-bg: #2a3942;
    }

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

    body {
      background-color: #0c1317;
      color: var(--wa-text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
      user-select: none;
    }

    .wa-doodle-bg {
      background-color: #0b141a;
      background-image: radial-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
                        radial-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 26px 26px;
      background-position: 0 0, 13px 13px;
    }

    .bubble-in {
      background-color: var(--wa-bubble-in);
      border-radius: 8px 8px 8px 2px;
      position: relative;
    }
    .bubble-in::before {
      content: '';
      position: absolute;
      top: 0;
      left: -6px;
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 0 8px 10px 0;
      border-color: transparent var(--wa-bubble-in-tail) transparent transparent;
    }

    .bubble-out {
      background-color: var(--wa-bubble-out);
      border-radius: 8px 8px 2px 8px;
      position: relative;
    }
    .bubble-out::after {
      content: '';
      position: absolute;
      top: 0;
      right: -6px;
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 0 0 10px 8px;
      border-color: transparent transparent transparent var(--wa-bubble-out-tail);
    }

    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.28); }

    @keyframes popIn {
      0% { opacity: 0; transform: translateY(6px) scale(0.98); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    .animate-pop-in { animation: popIn 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

    .wa-audio-bar {
      transition: height 0.12s ease, background-color 0.1s ease;
    }
    .wa-audio-bar:hover {
      filter: brightness(1.3);
      transform: scaleY(1.2);
    }

    .s23-frame {
      width: 412px;
      height: 890px;
      max-height: 92vh;
      border-radius: 44px;
      border: 10px solid #2b2f33;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1);
      overflow: hidden;
      position: relative;
    }
    .s23-camera-punch {
      position: absolute;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      width: 14px;
      height: 14px;
      background: #000;
      border-radius: 50%;
      z-index: 50;
      box-shadow: inset 0 0 2px #333;
    }
  </style>
</head>
<body class="flex flex-col bg-[#080d0f] overflow-hidden">

  <header class="bg-[#182229] border-b border-[#2a3942] px-3 py-2 flex flex-wrap items-center justify-between gap-2 z-40 text-xs shrink-0 shadow-md">
    <div class="flex items-center gap-2">
      <div class="w-6 h-6 rounded-lg bg-[#25d366] flex items-center justify-center text-[#111b21] font-bold">
        ✓
      </div>
      <div>
        <span class="font-bold text-white text-sm">Propuesta de Arreglo: WhatsApp Cloud</span>
        <span class="text-[11px] text-emerald-400 block sm:inline sm:ml-2">● Resuelve los 6 puntos reportados</span>
      </div>
    </div>

    <div class="flex items-center gap-1.5 overflow-x-auto py-1">
      <span class="text-[#8696a0] text-[11px] hidden md:inline">Pruebas rápidas:</span>
      <button onclick="simulateSearch('101')" class="px-2 py-0.5 rounded bg-[#202c33] hover:bg-[#2a3942] text-[#00a884] font-semibold border border-[#00a884]/40 transition active:scale-95">
        🔍 Buscar '101'
      </button>
      <button onclick="simulateSearch('102')" class="px-2 py-0.5 rounded bg-[#202c33] hover:bg-[#2a3942] text-[#00a884] font-semibold border border-[#00a884]/40 transition active:scale-95">
        🔍 Buscar '102' (Luna)
      </button>
      <button onclick="simulateSearch('202')" class="px-2 py-0.5 rounded bg-[#202c33] hover:bg-[#2a3942] text-[#00a884] font-semibold border border-[#00a884]/40 transition active:scale-95">
        🔍 Buscar '202'
      </button>
      <button onclick="simulateSearch('shalua')" class="px-2 py-0.5 rounded bg-[#202c33] hover:bg-[#2a3942] text-[#00a884] font-semibold border border-[#00a884]/40 transition active:scale-95">
        🔍 Buscar 'Shalua'
      </button>
      <button onclick="simulateSearch('')" class="px-2 py-0.5 rounded bg-[#202c33] hover:bg-[#2a3942] text-gray-300 transition active:scale-95">
        Ver todos
      </button>
    </div>

    <div class="flex items-center gap-2">
      <button id="toggleFrameBtn" onclick="toggleDeviceView()" class="px-3 py-1 rounded-full bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] font-bold text-xs flex items-center gap-1.5 shadow transition active:scale-95">
        <span id="frameBtnText">📱 Vista Samsung S23 Ultra</span>
      </button>
    </div>
  </header>

  <div id="fixBanner" class="bg-[#1f2c34] border-b border-[#2a3942] px-4 py-2 text-[11.5px] text-gray-300 flex items-center justify-between shrink-0">
    <div class="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1">
      <span class="font-bold text-emerald-400">🛡️ Garantía del arreglo:</span>
      <span><strong>1. Cero traslape:</strong> Al cambiar de Lauren a Luna, se resetea el estado y Luna carga limpia.</span>
      <span><strong>2. Sin auto-envío:</strong> Hacer clic en Luna NO dispara plantillas a Meta; el compositor queda bloqueado hasta que confirmes.</span>
      <span><strong>3. Pantalla 100%:</strong> Viewport a 100dvh exacto sin el dedo negro sobrante abajo.</span>
    </div>
    <button onclick="document.getElementById('fixBanner').style.display='none'" class="text-gray-400 hover:text-white ml-2 text-sm font-bold">✕</button>
  </div>

  <div id="appViewportContainer" class="flex-1 flex items-center justify-center min-h-0 overflow-hidden relative">

    <div id="appShell" class="w-full h-full flex overflow-hidden bg-[#0c1317] relative">
      
      <div id="s23PunchHole" class="s23-camera-punch hidden"></div>

      <aside id="sidebarPanel" class="w-full md:w-[360px] lg:w-[390px] bg-[#111b21] border-r border-[#222d34] flex flex-col shrink-0 z-20 transition-all duration-200 h-full">
        
        <div class="pt-3 pb-3 px-3.5 bg-[#1f2c34] flex items-center justify-between border-b border-[#222d34] shrink-0">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#25D366] to-[#128C7E] flex items-center justify-center text-white shadow-md shadow-[#25D366]/20 shrink-0">
              <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.699c.97.53 1.77.78 2.796.78 3.18 0 5.767-2.586 5.768-5.766 0-3.18-2.587-5.766-5.768-5.766zm3.364 8.163c-.144.405-.837.774-1.17.825-.311.047-.718.083-2.336-.587-1.745-.723-2.871-2.493-2.958-2.609-.088-.116-.708-.941-.708-1.793s.447-1.272.606-1.446c.159-.175.346-.219.462-.219.116 0 .232.001.332.006.106.005.249-.04.39.298.144.347.491 1.2.534 1.288.043.088.072.19.014.305-.058.116-.087.188-.173.289-.087.101-.183.226-.262.304-.088.087-.18.182-.077.359.102.176.455.75 1.026 1.258.736.654 1.357.857 1.549.953.192.096.305.084.418-.046.113-.13.483-.562.612-.755.13-.192.26-.16.435-.096.175.064 1.111.524 1.303.62.192.096.32.144.367.225.047.081.047.47-.097.875z"/>
              </svg>
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <h1 class="text-sm font-bold text-white tracking-tight leading-tight">WhatsApp Cloud</h1>
                <span class="text-[9.5px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-[#25D366]/20 text-[#25D366]">API</span>
              </div>
              <span class="text-[10.5px] text-[#8696a0] flex items-center gap-1 font-medium mt-0.5">
                <span class="w-2 h-2 rounded-full bg-[#25D366] shadow-[0_0_8px_#25D366]"></span>
                Edificio Laujim · Oficial
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1 text-[#aebac1]">
            <button onclick="renderConversationList()" class="p-1.5 hover:bg-white/10 rounded-full transition" title="Refrescar">
              🔄
            </button>
          </div>
        </div>

        <div class="p-2.5 bg-[#111b21]">
          <div class="relative flex items-center bg-[#202c33] rounded-lg px-3 py-1.5 focus-within:ring-1 focus-within:ring-[#00a884]">
            <span class="text-[#8696a0] mr-2">🔍</span>
            <input
              id="searchBox"
              type="text"
              oninput="handleSearch(this.value)"
              placeholder="Buscar 101, 102, 202, Shalua, Luna..."
              class="w-full bg-transparent text-xs text-[#e9edef] placeholder-[#8696a0] outline-none"
            />
            <button id="clearSearchBtn" onclick="simulateSearch('')" class="hidden text-gray-400 hover:text-white text-xs px-1">✕</button>
          </div>
        </div>

        <div class="px-3 py-1.5 bg-[#111b21] flex items-center justify-between border-b border-[#222d34] text-xs">
          <div class="flex items-center gap-2">
            <button id="tabAllBtn" class="px-3 py-0.5 rounded-full font-semibold bg-[#202c33] text-[#00a884] border border-[#00a884]/30">
              Todos (<span id="totalChatCount">4</span>)
            </button>
          </div>
          <span class="text-[10px] text-gray-400 italic">Orden: más recientes arriba</span>
        </div>

        <div id="conversationListContainer" class="flex-1 overflow-y-auto divide-y divide-[#222d34]/60">
        </div>

        <div class="p-2 bg-[#111b21] border-t border-[#222d34] flex items-center justify-between text-[11px] text-[#8696a0] shrink-0">
          <span class="text-rose-400 flex items-center gap-1 cursor-pointer hover:underline">
            ✕ Salir al Dashboard
          </span>
          <span class="text-[10px] text-gray-400">Canal oficial Meta Cloud</span>
        </div>
      </aside>

      <section id="chatPanel" class="flex-1 flex flex-col bg-[#0b141a] h-full relative overflow-hidden">
        
        <header class="h-14 px-3 bg-[#1f2c34] flex items-center justify-between border-b border-[#222d34] shrink-0 z-20">
          <div class="flex items-center gap-2.5 min-w-0">
            <button onclick="showMobileSidebar()" class="md:hidden p-1.5 hover:bg-white/10 rounded-full text-[#aebac1] transition mr-0.5" title="Volver">
              ⬅
            </button>

            <div id="chatHeaderBadge" class="w-9 h-9 rounded-full bg-[#1e3a47] border border-[#00a884]/40 text-[#00a884] font-bold text-xs flex items-center justify-center shrink-0 shadow">
              102
            </div>

            <div class="min-w-0">
              <h2 id="chatHeaderName" class="text-sm font-semibold text-[#e9edef] truncate leading-tight">
                Luna
              </h2>
              <p id="chatHeaderSub" class="text-[11px] text-[#8696a0] truncate">
                573142068643 · Apto. 102
              </p>
            </div>
          </div>

          <div class="flex items-center gap-1 text-[#aebac1] shrink-0">
            <button onclick="toggleTemplateModal()" class="p-2 hover:bg-white/10 rounded-full text-amber-400 transition" title="Plantillas oficiales Meta">
              📄 <span class="hidden sm:inline text-xs font-semibold">Plantillas</span>
            </button>
          </div>
        </header>

        <div id="windowStatusBar" class="px-3.5 py-1.5 flex items-center justify-between text-[11px] transition-colors shrink-0 border-b bg-[#241a18] border-[#4a2420] text-amber-200">
          <div class="flex items-center gap-1.5">
            <span id="windowStatusDot" class="w-2 h-2 rounded-full bg-amber-400"></span>
            <span id="windowStatusText" class="font-medium">Ventana cerrada · envía una plantilla aprobada</span>
          </div>
          <button id="windowActionBtn" onclick="toggleTemplateModal()" class="text-amber-400 hover:underline font-bold text-[11px]">
            Elegir plantilla ›
          </button>
        </div>

        <div id="templatesDrawer" class="hidden bg-[#1f2c34] border-b border-[#2a3942] p-3 text-xs text-gray-200 animate-pop-in shrink-0 z-30 shadow-xl">
          <div class="flex items-center justify-between mb-2 pb-1 border-b border-white/5">
            <div>
              <strong class="text-white text-xs block font-bold">Plantillas oficiales de Meta</strong>
              <span class="text-[10.5px] text-gray-400">Obligatorias cuando la ventana está cerrada. No se envía nada sin tu confirmación.</span>
            </div>
            <button onclick="toggleTemplateModal()" class="p-1 text-gray-400 hover:text-white font-bold">✕</button>
          </div>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
            <button onclick="previewTemplate('greeting')" class="p-2.5 rounded-lg bg-[#2a3942] hover:bg-[#32444f] text-left border border-gray-700/50 transition active:scale-98">
              <strong class="block text-emerald-400 text-xs">1. Saludo Inicial</strong>
              <span class="text-[11px] text-gray-300">'Hola, [Nombre], ¿cómo estás? ¿Podemos hablar un momento?'</span>
            </button>
            
            <button onclick="previewTemplate('payment_reminder')" class="p-2.5 rounded-lg bg-[#2a3942] hover:bg-[#32444f] text-left border border-gray-700/50 transition active:scale-98">
              <strong class="block text-blue-400 text-xs">2. Cobro Canon + Servicios</strong>
              <span class="text-[11px] text-gray-300">Desglose detallado de servicios públicos y botón de pago</span>
            </button>
          </div>

          <div id="templatePreviewBox" class="hidden p-3 rounded-lg bg-black/50 border border-emerald-500/40 mt-2">
            <div class="flex items-center justify-between text-xs text-emerald-300 font-bold mb-1.5">
              <span id="previewTitle">Vista Previa: Saludo Inicial</span>
              <span class="text-[10px] text-gray-400 font-normal">Revisa antes de enviar</span>
            </div>
            <p id="previewContent" class="text-xs text-gray-200 whitespace-pre-wrap font-sans bg-black/40 p-2.5 rounded border border-white/5 leading-relaxed"></p>
            <div class="mt-2.5 flex items-center justify-end gap-2">
              <button onclick="cancelTemplatePreview()" class="px-3 py-1 rounded text-xs text-gray-400 hover:text-white">
                Cancelar
              </button>
              <button onclick="confirmAndSendTemplate()" class="px-3.5 py-1 rounded bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] font-bold text-xs shadow-md transition active:scale-95">
                ✓ Confirmar y Enviar a WhatsApp
              </button>
            </div>
          </div>
        </div>

        <div id="messagesScrollArea" class="flex-1 overflow-y-auto px-3 sm:px-5 py-3 wa-doodle-bg flex flex-col space-y-2.5 relative">
          <div class="flex justify-center my-1 sticky top-1 z-10">
            <span class="bg-[#182229]/90 text-[#8696a0] text-[10px] px-3 py-0.5 rounded-lg uppercase tracking-wider font-semibold shadow border border-white/5 backdrop-blur-sm">
              Hoy
            </span>
          </div>

          <div id="messagesList" class="flex flex-col space-y-2.5">
          </div>

          <div id="messagesEnd"></div>
        </div>

        <footer class="w-full bg-[#202c33] px-2 sm:px-3 py-1.5 pb-2 flex items-center gap-1.5 shrink-0 z-20 border-t border-[#222d34]">
          
          <div id="composerPill" class="min-w-0 flex-1 rounded-2xl flex items-center px-2 py-1 gap-1 transition-all bg-[#182229] border border-gray-700/60 opacity-80 cursor-not-allowed">
            
            <button id="btnEmoji" disabled class="p-1 text-[#8696a0] disabled:opacity-40 shrink-0">
              😊
            </button>

            <input
              id="draftInput"
              type="text"
              disabled
              placeholder="Por favor envía una plantilla para iniciar la interacción"
              class="flex-1 bg-transparent text-sm outline-none px-1 py-1 min-w-0 w-0 text-gray-400 placeholder-gray-400 cursor-not-allowed text-xs"
            />

            <button id="btnClip" disabled class="p-1 text-[#8696a0] disabled:opacity-40 shrink-0" title="Adjuntar documento">
              📎
            </button>

            <button id="btnCamera" onclick="triggerNativeCamera()" class="p-1 text-emerald-400 hover:text-white transition shrink-0" title="Tomar foto con cámara del celular">
              📷
            </button>
          </div>

          <div class="shrink-0 flex items-center justify-center">
            <button
              id="btnMainAction"
              onclick="handleMainAction()"
              class="w-10 h-10 rounded-full flex items-center justify-center transition active:scale-90 shadow-md bg-[#2a3942] text-amber-400 hover:bg-[#344651]"
              title="Enviar plantilla aprobada"
            >
              <span id="mainActionIcon" class="text-base">📄</span>
            </button>
          </div>
        </footer>

      </section>

    </div>
  </div>

  <script>
    const apartmentsData = [
      { id: 1, name: '101', residents: ['Jim Carlos Varela Gomez', 'Shalua Quessep Martelo', 'Lauren Sofia Varela Gomez', 'Mercedes Gomez'] },
      { id: 2, name: '102', residents: ['Luna'] },
      { id: 3, name: '201', residents: ['Samir'] },
      { id: 4, name: '202', residents: ['Valery Vanessa Camargo Anaya'] },
      { id: 5, name: '203', residents: ['Juan Diego Orozco'] },
      { id: 6, name: '301', residents: ['Eukaris Cristina Castillo Marquez'] },
      { id: 7, name: '302', residents: ['Yhovanna Negrette Beltran'] },
      { id: 8, name: '303', residents: ['Edwin de Jesus Agamez Lara'] },
      { id: 9, name: '401', residents: ['Adela Victoria Gomez Gonzales'] },
      { id: 10, name: '402', residents: ['Carlos Arevalo'] },
      { id: 11, name: '403', residents: ['Solarte Bossio Yucelis del Carmen'] },
      { id: 12, name: '501', residents: ['Shelsy Keylin Polo Florez', 'Dayana Paola Villa Canate'] }
    ];

    let conversations = [
      {
        id: 1,
        tenantName: 'Jim Carlos Varela Gomez',
        phone: '573107203822',
        apartmentName: '101',
        windowOpen: true,
        lastTime: '11:20 p. m.',
        lastTimestamp: Date.now() - 5 * 60000,
        messages: [
          { id: 101, dir: 'out', type: 'text', text: 'Hola Jim, te adjunto el recibo de energía de este mes.', time: '11:10 p. m.' },
          { 
            id: 102, dir: 'in', type: 'audio', duration: 14, time: '11:15 p. m.',
            waveform: [6, 14, 22, 28, 16, 8, 12, 18, 26, 18, 10, 14, 22, 16, 8, 12, 18, 14, 6, 10, 16, 12, 6, 4]
          },
          { id: 103, dir: 'out', type: 'text', text: 'Excelente Jim, ya quedó registrado el pago.', time: '11:20 p. m.' }
        ]
      },
      {
        id: 2,
        tenantName: 'Lauren Sofia Varela Gomez',
        phone: '573012095030',
        apartmentName: '101',
        windowOpen: false,
        lastTime: '11:00 p. m.',
        lastTimestamp: Date.now() - 25 * 60000,
        messages: [
          { id: 201, dir: 'out', type: 'template', text: 'Hola, Lauren, ¿cómo estás? ¿Podemos hablar un momento?', time: '11:00 p. m.' },
          { id: 202, dir: 'out', type: 'template', text: 'Hola, Lauren, ¿cómo estás? ¿Podemos hablar un momento?', time: '11:00 p. m.' }
        ]
      },
      {
        id: 8,
        tenantName: 'Shalua Quessep Martelo',
        phone: '573117602815',
        apartmentName: '101',
        windowOpen: false,
        lastTime: 'Ayer',
        lastTimestamp: Date.now() - 24 * 3600000,
        messages: [
          { id: 801, dir: 'in', type: 'text', text: 'Buenas tardes, ¿me confirman si recibieron el comprobante?', time: 'Ayer 04:30 p. m.' },
          { id: 802, dir: 'out', type: 'text', text: 'Confirmado Shalua, muchas gracias.', time: 'Ayer 04:35 p. m.' }
        ]
      },
      {
        id: 24,
        tenantName: 'Luna',
        phone: '573142068643',
        apartmentName: '102',
        windowOpen: false,
        lastTime: '',
        lastTimestamp: 0,
        messages: []
      }
    ];

    const allContacts = [
      { name: 'Valery Vanessa Camargo Anaya', phone: '3102357336', apartmentName: '202' },
      { name: 'Samir', phone: '3233167293', apartmentName: '201' },
      { name: 'Mercedes Gomez', phone: '3100000000', apartmentName: '101' },
      { name: 'Juan Diego Orozco', phone: '3013757910', apartmentName: '203' },
      { name: 'Shelsy Keylin Polo Florez', phone: '3023100891', apartmentName: '501' }
    ];

    let currentConversationId = 24;
    let activeSearchQuery = '';
    let selectedTemplateForPreview = null;
    let isS23Frame = false;
    let audioPlaybackState = { playingId: null, speed: 1, timer: null, progress: 0 };

    function playTone(freq, type, duration) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch(e) {}
    }
    function playSentSound() { playTone(587.33, 'sine', 0.12); setTimeout(() => playTone(880, 'sine', 0.18), 90); }

    function handleSearch(val) {
      activeSearchQuery = (val || '').trim().toLowerCase();
      const clearBtn = document.getElementById('clearSearchBtn');
      if (clearBtn) clearBtn.classList.toggle('hidden', !activeSearchQuery);
      renderConversationList();
    }

    function simulateSearch(term) {
      const box = document.getElementById('searchBox');
      if (box) {
        box.value = term;
        handleSearch(term);
      }
    }

    function renderConversationList() {
      const container = document.getElementById('conversationListContainer');
      if (!container) return;

      const q = activeSearchQuery;
      const numMatch = (q.match(/\\d+/) || [''])[0];

      const sortedConversations = [...conversations].sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));

      const matchingConvs = sortedConversations.filter(c => {
        if (!q) return true;
        const aptStr = String(c.apartmentName || '').toLowerCase();
        const nameStr = String(c.tenantName || '').toLowerCase();
        const phoneStr = String(c.phone || '');
        
        const aptObj = apartmentsData.find(a => a.name === c.apartmentName);
        const coResidents = aptObj ? aptObj.residents.join(' ').toLowerCase() : '';

        return nameStr.includes(q) || aptStr.includes(q) || (numMatch && aptStr === numMatch) || phoneStr.includes(q) || coResidents.includes(q);
      });

      const matchingContacts = allContacts.filter(contact => {
        if (!q) return false;
        if (matchingConvs.some(c => c.tenantName.toLowerCase() === contact.name.toLowerCase())) return false;

        const aptStr = String(contact.apartmentName || '').toLowerCase();
        const nameStr = String(contact.name || '').toLowerCase();
        const aptObj = apartmentsData.find(a => a.name === contact.apartmentName);
        const coResidents = aptObj ? aptObj.residents.join(' ').toLowerCase() : '';

        return nameStr.includes(q) || aptStr.includes(q) || (numMatch && aptStr === numMatch) || coResidents.includes(q);
      });

      document.getElementById('totalChatCount').textContent = sortedConversations.length;

      let html = '';

      if (matchingConvs.length === 0 && matchingContacts.length === 0) {
        html = \`
          <div class="p-6 text-center text-xs text-[#8696a0]">
            No se encontraron apartamentos ni contactos que coincidan con '<strong>\${q}</strong>'.
          </div>
        \`;
      } else {
        matchingConvs.forEach(conv => {
          const isSelected = conv.id === currentConversationId;
          const lastMsg = conv.messages && conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
          let preview = 'Sin mensajes todavía';
          if (lastMsg) {
            if (lastMsg.type === 'text') preview = lastMsg.text;
            else if (lastMsg.type === 'template') preview = '📄 ' + lastMsg.text;
            else if (lastMsg.type === 'audio') preview = '🎙 Nota de voz (0:14)';
          }

          html += \`
            <div
              onclick="selectConversation(\${conv.id})"
              class="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition select-none \${
                isSelected ? 'bg-[#2a3942]/80 border-l-4 border-[#00a884]' : 'hover:bg-[#202c33]/50'
              }"
            >
              <div class="w-11 h-11 rounded-full font-bold text-xs flex items-center justify-center shrink-0 shadow \${
                isSelected ? 'bg-[#00a884] text-[#111b21]' : 'bg-[#1e3a47] text-[#00a884]'
              }">
                \${conv.apartmentName}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-semibold text-[#e9edef] truncate">\${conv.tenantName}</span>
                  <span class="text-[10px] text-[#8696a0] shrink-0">\${conv.lastTime || ''}</span>
                </div>
                <div class="flex items-center justify-between mt-0.5">
                  <p class="text-xs text-[#8696a0] truncate flex-1">\${preview}</p>
                </div>
                <div class="flex items-center gap-1.5 mt-0.5 text-[10px]">
                  <span class="w-1.5 h-1.5 rounded-full \${conv.windowOpen ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
                  <span class="\${conv.windowOpen ? 'text-emerald-300' : 'text-amber-300'}">
                    \${conv.windowOpen ? 'Ventana activa' : 'Requiere plantilla'} · Apto. \${conv.apartmentName}
                  </span>
                </div>
              </div>
            </div>
          \`;
        });

        if (matchingContacts.length > 0) {
          html += \`
            <div class="border-t border-[#222d34] bg-[#142027]">
              <div class="px-3 py-1.5 text-[10px] font-bold text-[#00a884] uppercase tracking-wider bg-[#182229] flex items-center justify-between">
                <span>Residentes y Contactos (\${matchingContacts.length})</span>
                <span class="text-gray-400 font-normal">Toca para abrir chat seguro</span>
              </div>
          \`;
          matchingContacts.forEach(contact => {
            html += \`
              <div
                onclick="startChatWithContact('\${contact.name}', '\${contact.phone}', '\${contact.apartmentName}')"
                class="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#202c33]/70 transition select-none border-b border-[#222d34]/40"
              >
                <div class="w-11 h-11 rounded-full bg-[#1e3a47] text-[#00a884] font-bold text-xs flex items-center justify-center shrink-0 shadow">
                  \${contact.apartmentName}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold text-[#e9edef] truncate">\${contact.name}</span>
                    <span class="text-[10px] text-[#00a884] font-medium bg-[#00a884]/15 px-2 py-0.5 rounded-full shrink-0">
                      Abrir chat
                    </span>
                  </div>
                  <p class="text-xs text-[#8696a0] truncate mt-0.5">
                    \${contact.phone} · Apto. \${contact.apartmentName}
                  </p>
                </div>
              </div>
            \`;
          });
          html += '</div>';
        }
      }

      container.innerHTML = html;
    }

    function selectConversation(id) {
      currentConversationId = id;
      stopAudioPlayback();
      document.getElementById('templatesDrawer').classList.add('hidden');
      document.getElementById('templatePreviewBox').classList.add('hidden');
      selectedTemplateForPreview = null;

      if (window.innerWidth < 768 || isS23Frame) {
        document.getElementById('sidebarPanel').classList.add('hidden');
        document.getElementById('chatPanel').classList.remove('hidden');
      }

      renderConversationList();
      renderActiveChat();
    }

    function startChatWithContact(name, phone, apt) {
      let existing = conversations.find(c => c.tenantName.toLowerCase() === name.toLowerCase());
      if (!existing) {
        const newId = Date.now();
        existing = {
          id: newId,
          tenantName: name,
          phone: phone,
          apartmentName: apt,
          windowOpen: false,
          lastTime: 'Ahora',
          lastTimestamp: Date.now(),
          messages: []
        };
        conversations.unshift(existing);
      }
      selectConversation(existing.id);
    }

    function renderActiveChat() {
      const conv = conversations.find(c => c.id === currentConversationId);
      if (!conv) return;

      document.getElementById('chatHeaderBadge').textContent = conv.apartmentName;
      document.getElementById('chatHeaderName').textContent = conv.tenantName;
      document.getElementById('chatHeaderSub').textContent = \`\${conv.phone} · Apto. \${conv.apartmentName}\`;

      const bar = document.getElementById('windowStatusBar');
      const dot = document.getElementById('windowStatusDot');
      const text = document.getElementById('windowStatusText');
      const actionBtn = document.getElementById('windowActionBtn');

      if (conv.windowOpen) {
        bar.className = 'px-3.5 py-1.5 flex items-center justify-between text-[11px] transition-colors shrink-0 border-b bg-[#182229] border-[#222d34] text-gray-300';
        dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
        text.textContent = 'Ventana activa Meta Cloud (24h abierta)';
        actionBtn.textContent = 'Opciones ›';
      } else {
        bar.className = 'px-3.5 py-1.5 flex items-center justify-between text-[11px] transition-colors shrink-0 border-b bg-[#241a18] border-[#4a2420] text-amber-200';
        dot.className = 'w-2 h-2 rounded-full bg-amber-400';
        text.textContent = 'Ventana cerrada · envía una plantilla aprobada';
        actionBtn.textContent = 'Elegir plantilla ›';
      }

      const pill = document.getElementById('composerPill');
      const draft = document.getElementById('draftInput');
      const btnAction = document.getElementById('btnMainAction');
      const actionIcon = document.getElementById('mainActionIcon');

      if (conv.windowOpen) {
        pill.className = 'min-w-0 flex-1 rounded-2xl flex items-center px-2 py-1 gap-1 transition-all bg-[#2a3942] border border-transparent focus-within:ring-1 focus-within:ring-[#00a884] opacity-100 cursor-text';
        draft.disabled = false;
        draft.placeholder = 'Escribe un mensaje libre...';
        draft.className = 'flex-1 bg-transparent text-sm outline-none px-1 py-1 min-w-0 w-0 text-[#e9edef] placeholder-[#8696a0] text-xs';
        btnAction.className = 'w-10 h-10 rounded-full flex items-center justify-center transition active:scale-90 shadow-md bg-[#00a884] text-[#111b21] hover:bg-[#06cf9c]';
        actionIcon.textContent = '🎙';
        btnAction.title = 'Grabar nota de voz';
      } else {
        pill.className = 'min-w-0 flex-1 rounded-2xl flex items-center px-2 py-1 gap-1 transition-all bg-[#182229] border border-gray-700/60 opacity-80 cursor-not-allowed';
        draft.disabled = true;
        draft.value = '';
        draft.placeholder = 'Por favor envía una plantilla para iniciar la interacción';
        draft.className = 'flex-1 bg-transparent text-sm outline-none px-1 py-1 min-w-0 w-0 text-gray-400 placeholder-gray-400 cursor-not-allowed text-xs';
        btnAction.className = 'w-10 h-10 rounded-full flex items-center justify-center transition active:scale-90 shadow-md bg-[#2a3942] text-amber-400 hover:bg-[#344651]';
        actionIcon.textContent = '📄';
        btnAction.title = 'Enviar plantilla aprobada';
      }

      const list = document.getElementById('messagesList');
      if (!list) return;

      if (!conv.messages || conv.messages.length === 0) {
        list.innerHTML = \`
          <div class="p-8 text-center text-xs text-[#8696a0]">
            <div class="w-12 h-12 rounded-full bg-[#182229] flex items-center justify-center mx-auto mb-2 text-xl">
              💬
            </div>
            <strong class="text-gray-300 block mb-1">No hay mensajes previos en esta conversación.</strong>
            <span>La ventana de Meta está cerrada. Utiliza el botón <strong>'Elegir plantilla'</strong> para iniciar la conversación con una plantilla oficial aprobada.</span>
          </div>
        \`;
      } else {
        let msgsHtml = '';
        conv.messages.forEach(msg => {
          const isOut = msg.dir === 'out';
          msgsHtml += \`
            <div class="flex \${isOut ? 'justify-end' : 'justify-start'} animate-pop-in">
              <div class="\${isOut ? 'bubble-out' : 'bubble-in'} max-w-[86%] sm:max-w-[76%] px-3 py-2 text-[#e9edef] shadow-md relative">
          \`;

          if (msg.type === 'text' || msg.type === 'template') {
            msgsHtml += \`
              <p class="leading-relaxed text-sm whitespace-pre-wrap">\${msg.text}</p>
            \`;
          } else if (msg.type === 'audio') {
            msgsHtml += renderWhatsAppVoicePlayer(msg);
          }

          msgsHtml += \`
                <div class="flex items-center justify-end gap-1 mt-1 text-[10px] text-[#8696a0] select-none">
                  <span>\${msg.time}</span>
                  \${isOut ? '<span class="text-[#53bdeb] text-xs font-bold">✓✓</span>' : ''}
                </div>
              </div>
            </div>
          \`;
        });
        list.innerHTML = msgsHtml;
      }

      setTimeout(() => {
        const end = document.getElementById('messagesEnd');
        if (end) end.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    function renderWhatsAppVoicePlayer(msg) {
      const isPlaying = audioPlaybackState.playingId === msg.id;
      const bars = msg.waveform || [6, 12, 18, 24, 14, 8, 12, 18, 24, 16, 10, 14, 20, 16, 8, 12, 18, 14, 6, 10, 16, 12, 6, 4];
      const activeBar = Math.floor((audioPlaybackState.progress || 0) * bars.length);

      let waveformHtml = '';
      bars.forEach((h, idx) => {
        const isPassed = idx <= activeBar && isPlaying;
        waveformHtml += \`
          <div
            onclick="seekAudio(\${idx / bars.length})"
            class="wa-audio-bar flex-1 rounded-[1.5px] cursor-pointer"
            style="height: \${h}px; background-color: \${isPassed ? '#53bdeb' : '#8696a0'};"
          ></div>
        \`;
      });

      return \`
        <div class="w-64 sm:w-72 py-1 select-none">
          <div class="flex items-center gap-2.5">
            <button
              onclick="toggleAudioPlay(\${msg.id})"
              class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition active:scale-95 shadow \${
                isPlaying ? 'bg-[#25d366] text-[#0b1418]' : 'bg-[#00a884] text-[#111b21]'
              }"
            >
              <span class="text-xs font-bold">\${isPlaying ? '❚❚' : '▶'}</span>
            </button>

            <div class="flex-1 flex items-center gap-[2.5px] h-8 px-1">
              ${waveformHtml}
            </div>

            <button
              onclick="cycleAudioSpeed()"
              class="px-2 py-0.5 rounded-full bg-[#2a3942] hover:bg-[#374955] text-[11px] font-bold text-white border border-white/10 shrink-0"
            >
              \${audioPlaybackState.speed}x
            </button>
          </div>

          <div class="flex items-center justify-between text-[11px] text-[#8696a0] mt-1 px-1">
            <span class="font-mono">\${isPlaying ? '0:07' : '0:14'}</span>
            <span class="text-emerald-400 text-xs">🎙 Nota de voz</span>
          </div>
        </div>
      \`;
    }

    function toggleAudioPlay(msgId) {
      if (audioPlaybackState.playingId === msgId) {
        stopAudioPlayback();
      } else {
        audioPlaybackState.playingId = msgId;
        audioPlaybackState.progress = 0;
        playTone(600, 'sine', 0.1);
        if (audioPlaybackState.timer) clearInterval(audioPlaybackState.timer);
        audioPlaybackState.timer = setInterval(() => {
          audioPlaybackState.progress += 0.05 * audioPlaybackState.speed;
          if (audioPlaybackState.progress >= 1) {
            stopAudioPlayback();
          } else {
            renderActiveChat();
          }
        }, 300);
      }
      renderActiveChat();
    }

    function stopAudioPlayback() {
      if (audioPlaybackState.timer) clearInterval(audioPlaybackState.timer);
      audioPlaybackState.playingId = null;
      audioPlaybackState.progress = 0;
      renderActiveChat();
    }

    function cycleAudioSpeed() {
      const speeds = [1, 1.5, 2];
      const next = speeds[(speeds.indexOf(audioPlaybackState.speed) + 1) % speeds.length];
      audioPlaybackState.speed = next;
      renderActiveChat();
    }

    function seekAudio(percent) {
      audioPlaybackState.progress = percent;
      renderActiveChat();
    }

    function toggleTemplateModal() {
      const drawer = document.getElementById('templatesDrawer');
      drawer.classList.toggle('hidden');
      if (drawer.classList.contains('hidden')) {
        document.getElementById('templatePreviewBox').classList.add('hidden');
      }
    }

    function previewTemplate(type) {
      const conv = conversations.find(c => c.id === currentConversationId);
      if (!conv) return;

      selectedTemplateForPreview = type;
      const previewBox = document.getElementById('templatePreviewBox');
      const title = document.getElementById('previewTitle');
      const content = document.getElementById('previewContent');

      previewBox.classList.remove('hidden');

      if (type === 'greeting') {
        title.textContent = \`Vista Previa: Saludo Inicial · \${conv.tenantName}\`;
        content.textContent = \`Hola, \${conv.tenantName.split(' ')[0]}, ¿cómo estás? ¿Podemos hablar un momento sobre el Apto. \${conv.apartmentName}?\`;
      } else if (type === 'payment_reminder') {
        title.textContent = \`Vista Previa: Cobro Servicios · Apto \${conv.apartmentName}\`;
        content.textContent = \`Estimado(a) \${conv.tenantName},\\nTe compartimos el estado de cuenta y servicios públicos para el Apto. \${conv.apartmentName}:\\n• Canon de arrendamiento: Al día\\n• Energía (Air-e): $145.200\\n• Acueducto (Triple A): $58.300\\n• Gas Natural: $32.100\\nTotal a cancelar: $235.600. Por favor confirma una vez realizado el pago.\`;
      }
    }

    function cancelTemplatePreview() {
      document.getElementById('templatePreviewBox').classList.add('hidden');
      selectedTemplateForPreview = null;
    }

    function confirmAndSendTemplate() {
      const conv = conversations.find(c => c.id === currentConversationId);
      if (!conv || !selectedTemplateForPreview) return;

      const content = document.getElementById('previewContent').textContent;
      const newMsg = {
        id: Date.now(),
        dir: 'out',
        type: 'template',
        text: content,
        time: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
      };

      conv.messages.push(newMsg);
      conv.lastTime = newMsg.time;
      conv.lastTimestamp = Date.now();
      
      toggleTemplateModal();
      playSentSound();
      renderConversationList();
      renderActiveChat();
    }

    function handleMainAction() {
      const conv = conversations.find(c => c.id === currentConversationId);
      if (!conv) return;

      if (!conv.windowOpen) {
        toggleTemplateModal();
      } else {
        alert('Grabación de nota de voz activa. Al soltar se enviará con formato WhatsApp oficial.');
      }
    }

    function triggerNativeCamera() {
      playTone(700, 'sine', 0.1);
      alert('📷 Cámara Nativa:\\nEn el APK Android se invoca directamente la cámara del Samsung Galaxy (MediaStore.ACTION_IMAGE_CAPTURE) con permisos de archivo seguros sin abrir el explorador de archivos.');
    }

    function toggleDeviceView() {
      isS23Frame = !isS23Frame;
      const shell = document.getElementById('appShell');
      const punch = document.getElementById('s23PunchHole');
      const btnText = document.getElementById('frameBtnText');

      if (isS23Frame) {
        shell.className = 's23-frame flex overflow-hidden bg-[#0c1317] relative';
        punch.classList.remove('hidden');
        btnText.textContent = '💻 Vista Pantalla Completa';
        document.getElementById('sidebarPanel').classList.add('hidden');
        document.getElementById('chatPanel').classList.remove('hidden');
      } else {
        shell.className = 'w-full h-full flex overflow-hidden bg-[#0c1317] relative';
        punch.classList.add('hidden');
        btnText.textContent = '📱 Vista Samsung S23 Ultra';
        document.getElementById('sidebarPanel').classList.remove('hidden');
        document.getElementById('chatPanel').classList.remove('hidden');
      }
      renderConversationList();
      renderActiveChat();
    }

    function showMobileSidebar() {
      document.getElementById('sidebarPanel').classList.remove('hidden');
      document.getElementById('chatPanel').classList.add('hidden');
    }

    window.addEventListener('DOMContentLoaded', () => {
      renderConversationList();
      renderActiveChat();
    });
  </script>
</body>
</html>`;

fs.writeFileSync(targetPath, html, 'utf8');
console.log('Successfully written', targetPath);
