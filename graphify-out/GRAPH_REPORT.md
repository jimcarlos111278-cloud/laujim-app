# Graph Report - Proyecto Laujim APP fix  (2026-08-11)

## Corpus Check
- 140 files · ~164,405 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1552 nodes · 3135 edges · 149 communities (108 shown, 41 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5ddcc76e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- handleCloudAdminMessage
- ApartmentDetail.jsx
- .status
- server.cjs
- pre-whatsapp-bot/server.cjs
- _head_server.cjs
- extension/manifest.json
- startServer
- dependencies
- saveData
- dependencies
- api.js
- handleCloudInbound
- BroadcastReceiver
- content-facebook.js
- Layout.jsx
- handleCloudInbound
- scripts
- sleep
- chrome-cdp.js
- getR2Client
- 5. ESPECIFICACIÓN DE INTEGRACIÓN (LO QUE CODEX DEBE CONSTRUIR)
- chat.js
- services-scraper.cjs
- contractGenerator.js
- setup-graphify-hooks.cjs
- runPaymentReminders
- public/manifest.json
- sync-aiven-before-push.cjs
- cloudPaymentTemplateData
- graphify.js
- startServer
- devDependencies
- scripts
- backup.js
- @capacitor/core
- @capacitor/share
- worker-protocol.cjs
- opencode.json
- portal-scraper.js
- App.jsx
- tailwindcss
- .oxlintrc.json
- add-passwords.js
- ScraperWorker.jsx
- Settings.jsx
- Gestión de Apartamentos — Laujim APP
- ffmpeg-static
- generate-version.js
- MainActivity.java
- content-portals.js
- popup.js
- deploy-snapshot.cjs
- seed-data.js
- ExampleInstrumentedTest.java
- content-laujim.js
- copy-apk.js
- fix-html.js
- migrate-to-aiven.cjs
- sync-seed.js
- Historial de Cambios
- darkMode.js
- ExampleUnitTest.java
- gradlew
- ScraperWorkerService
- clipboard.js
- Extensión de Chrome — Llenar Laujim
- recharts
- @tailwindcss/vite
- pre-whatsapp-bot/package.json
- Plan — Cámaras + Timbre QR + Integración Laujim APP
- react-dom
- cdp-driver.cjs
- 2. Modos de ejecución
- cdp-driver.mjs
- background.js
- pre-commit
- sw.js
- graphify-update.cjs
- Configuración Específica por Archivo
- scrapeGasAccount
- Sistema de Temas (6 Temas Visuales)
- Construir APK para Android
- API REST Completa
- ThemeSelector.jsx
- Convertir a APK con Capacitor
- WhatsApp Business Platform — puesta en marcha
- Base de Datos en Memoria
- Servicios Públicos y QR de Pago
- Datos Iniciales (Seed)
- Consulta de Antecedentes (Policía)
- Sistema de Chat
- Persistencia PostgreSQL
- Requerimientos del Sistema
- Sistema de Autenticación
- runGasScrapeOnce
- puppeteer-core
- matchPortalApartmentForService
- pre-push
- jspdf
- react
- @capacitor/core
- pg
- multer
- @sparticuz/chromium
- Worker portatil de servicios
- lucide-react
- getBase
- test-water-scraper.cjs
- @capacitor/local-notifications
- @capacitor/filesystem
- scrapeAirE
- PortalBrowserActivity
- Plantillas de WhatsApp Cloud de Laujim
- _scrape-diagnostic.cjs
- node-cron
- portable-worker.cjs
- Plantilla de WhatsApp: cobro_canon_servicios
- @capacitor-mlkit/barcode-scanning
- dexie
- jspdf
- jsqr
- lucide-react
- multer
- docker-start-render.sh
- react-dom
- react-router-dom
- recharts
- @tailwindcss/vite
- @capacitor-mlkit/barcode-scanning
- @capacitor/cli
- cors
- ErrorBoundary
- prepare-capacitor-assets.js

## God Nodes (most connected - your core abstractions)
1. `startServer()` - 48 edges
2. `startServer()` - 46 edges
3. `getBase()` - 35 edges
4. `handleCloudAdminMessage()` - 33 edges
5. `handleCloudInbound()` - 29 edges
6. `react` - 27 edges
7. `scrapeGasAccount()` - 27 edges
8. `ScraperWorkerService` - 26 edges
9. `saveData()` - 26 edges
10. `handleCloudInbound()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `portalFieldValue()` --indirect_call--> `field()`  [INFERRED]
  services-scraper.cjs → android/app/src/main/assets/portal-scraper.js
- `generateContractPDF()` --references--> `jspdf`  [EXTRACTED]
  src/utils/contractGenerator.js → package.json
- `generateApartmentPDF()` --references--> `jspdf`  [EXTRACTED]
  src/utils/pdf.js → package.json
- `uploadFile()` --calls--> `getRawBase()`  [EXTRACTED]
  src/api.js → src/utils/config.js
- `ProtectedRoute()` --calls--> `getAuth()`  [EXTRACTED]
  src/App.jsx → src/utils/auth.js

## Import Cycles
- None detected.

## Communities (149 total, 41 thin omitted)

### Community 0 - "handleCloudAdminMessage"
Cohesion: 0.36
Nodes (22): cloudApartmentsForFloor(), cloudFindApartment(), cloudListSections(), handleCloudAdminMessage(), occupiedCloudApartments(), saveData(), sendCloudAdminMenu(), sendCloudIncidentAmountPrompt() (+14 more)

### Community 1 - "ApartmentDetail.jsx"
Cohesion: 0.08
Nodes (46): COLORS, CustomTooltip(), getChartData(), getPaymentStatus(), PaymentHistoryChart(), StatsCard(), ApartmentDetail(), serviceColors (+38 more)

### Community 2 - ".status"
Cohesion: 0.11
Nodes (15): ActivityCallback, ActivityResult, AuthorizedCallerPlugin, CapacitorPlugin, JSObject, PluginCall, PluginMethod, AuthorizedCallerScreeningService (+7 more)

### Community 3 - "server.cjs"
Cohesion: 0.05
Nodes (49): app, BACKUP_DIR, BACKUP_FILE, buildCloudApartmentServicesInfo(), buildCloudDetailedApartmentServicesInfo(), buildDebtReply(), CLOUD_SERVICE_PRESENTATIONS, cloudApartmentFloor() (+41 more)

### Community 4 - "pre-whatsapp-bot/server.cjs"
Cohesion: 0.08
Nodes (31): INITIAL_DATA, app, BACKUP_DIR, BACKUP_FILE, CONTRACTS_DIR, cors, DATA_DIR, DATA_FILE (+23 more)

### Community 5 - "_head_server.cjs"
Cohesion: 0.06
Nodes (36): INITIAL_DATA, app, BACKUP_DIR, BACKUP_FILE, CONTRACTS_DIR, cors, crypto, DATA_DIR (+28 more)

### Community 6 - "extension/manifest.json"
Cohesion: 0.07
Nodes (29): action, default_icon, default_popup, default_title, background, service_worker, content_scripts, 128 (+21 more)

### Community 7 - "startServer"
Cohesion: 0.16
Nodes (21): archiveCloudInboundMedia(), cloudApiRequest(), cloudConfig(), cloudGraphRequest(), cloudMediaKind(), cloudPeriodLabel(), cloudReady(), downloadCloudMedia() (+13 more)

### Community 8 - "dependencies"
Cohesion: 0.12
Nodes (17): @aws-sdk/client-s3, @capacitor/android, cors, dexie, express, jsqr, dependencies, @aws-sdk/client-s3 (+9 more)

### Community 9 - "saveData"
Cohesion: 0.24
Nodes (11): constantTimeEqual(), createAuthSession(), ensureAuthSessions(), getAuthSession(), loadData(), pruneAuthSessions(), recalcNextId(), removeAuthSession() (+3 more)

### Community 10 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, @capacitor/android, @capacitor/cli, @capacitor/local-notifications, @capacitor/share, express, pg, qrcode (+11 more)

### Community 11 - "api.js"
Cohesion: 0.11
Nodes (31): CLOUD_COLLECTIONS, createItem(), deleteItem(), getCloudSyncStatus(), getDataVersion(), lastCloudSyncStatus, refreshAllFromServer(), serverReq() (+23 more)

### Community 12 - "handleCloudInbound"
Cohesion: 0.22
Nodes (21): addCloudMessage(), authorizedCloudContact(), blockCloudUser(), clearCloudAuthState(), cloudInboundMedia(), cloudInteractiveReply(), ensureCloudCollections(), failCloudAuthentication() (+13 more)

### Community 13 - "BroadcastReceiver"
Cohesion: 0.10
Nodes (21): AuthorizedMmsReceiver, Context, Intent, Override, AuthorizedSmsReceiver, Context, Intent, Override (+13 more)

### Community 14 - "content-facebook.js"
Cohesion: 0.25
Nodes (22): activate(), autoFill(), checkAndRun(), chooseDropdown(), fillAndConfirmAddress(), fillAndConfirmAddressReliable(), findAndSet(), findDropdown() (+14 more)

### Community 15 - "Layout.jsx"
Cohesion: 0.43
Nodes (4): Layout(), navItems, clearAppData(), isServerAvailable()

### Community 16 - "handleCloudInbound"
Cohesion: 0.14
Nodes (26): authorizedCloudContact(), blockCloudUser(), clearCloudAuthState(), cloudAdminGreeting(), cloudAdminPhones(), cloudInboundMedia(), cloudInteractiveReply(), ensureCloudCollections() (+18 more)

### Community 17 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, backup, build, build-apk, dev, lint, network, preview (+2 more)

### Community 18 - "sleep"
Cohesion: 0.32
Nodes (12): clickVisibleButton(), inspectWaterPage(), loginPortalPage(), portalFrameRoots(), portalLoginDiagnostic(), sleep(), submitPortalLoginForm(), typeVisibleField() (+4 more)

### Community 19 - "chrome-cdp.js"
Cohesion: 0.53
Nodes (5): BROWSER_TOOL_PREFIXES, chromeCandidates(), ensureChromeCdp(), findChrome(), isCdpListening()

### Community 20 - "getR2Client"
Cohesion: 0.42
Nodes (10): deleteR2Object(), ensureR2Usage(), getR2Client(), getR2Usage(), putR2Buffer(), r2Config(), r2Key(), r2Ready() (+2 more)

### Community 21 - "5. ESPECIFICACIÓN DE INTEGRACIÓN (LO QUE CODEX DEBE CONSTRUIR)"
Cohesion: 0.07
Nodes (27): 1.1 Identidad, 1.2 Stack (verificado en package.json + README), 1.3 Autenticación, 1.4 Colecciones existentes (13 núcleo), 1.5 Datos relevantes por apartamento, 1.6 Puntos de extensión existentes (patrones a imitar), 1. ESTADO ACTUAL DE LA APP, 2. LIMITACIONES DE HARDWARE / INFRAESTRUCTURA (CRÍTICAS) (+19 more)

### Community 22 - "chat.js"
Cohesion: 0.21
Nodes (22): AdminRoute(), ProtectedRoute(), Chat(), getAuth(), getTenantApartmentId(), isAdmin(), isTenant(), requireAuth() (+14 more)

### Community 23 - "services-scraper.cjs"
Cohesion: 0.07
Nodes (30): aggregateAirEInvoices(), AIR_E_NIC_MAP, AIR_E_URLS, BROWSERLESS_REGION, BROWSERLESS_SOLVE_CAPTCHAS, BROWSERLESS_STEALTH, BROWSERLESS_TIMEOUT_MS, BROWSERLESS_TOKENS (+22 more)

### Community 24 - "contractGenerator.js"
Cohesion: 0.17
Nodes (13): centenasALetras(), CIENTOS, CLAUSULAS, DECENAS, ESPECIALES, fechaEnLetras(), generateContractPDF(), limpiarNumero() (+5 more)

### Community 25 - "setup-graphify-hooks.cjs"
Cohesion: 0.20
Nodes (9): DST, { existsSync, copyFileSync, mkdirSync, chmodSync }, GIT_DIR, HOOKS_DIR, { join, dirname }, PRE_PUSH_DST, PRE_PUSH_SRC, ROOT (+1 more)

### Community 26 - "runPaymentReminders"
Cohesion: 0.38
Nodes (7): activeContractForApartment(), colombiaDate(), createPendingPaymentFromProof(), paymentCountsAsCollected(), paymentPeriod(), paymentReminderOffsets(), runPaymentReminders()

### Community 27 - "public/manifest.json"
Cohesion: 0.14
Nodes (13): background_color, categories, description, display, icons, name, orientation, screenshots (+5 more)

### Community 28 - "sync-aiven-before-push.cjs"
Cohesion: 0.24
Nodes (9): collectionCount(), DATA_FILE, { execFileSync }, fs, localDataChanged(), path, { Pool }, ROOT (+1 more)

### Community 29 - "cloudPaymentTemplateData"
Cohesion: 0.09
Nodes (39): activeContractForApartment(), activeTenantForApartment(), addCloudMessage(), buildAdminDebtReport(), buildCloudDetailedGlobalServicesReport(), buildCloudGlobalServicesReport(), cloudApartmentServicesLine(), cloudApiRequest() (+31 more)

### Community 31 - "startServer"
Cohesion: 0.10
Nodes (35): archiveCloudInboundMedia(), cloudConfig(), cloudGraphRequest(), cloudMediaKind(), cloudReady(), constantTimeEqual(), createAuthSession(), decryptSecret() (+27 more)

### Community 32 - "devDependencies"
Cohesion: 0.18
Nodes (11): devDependencies, oxlint, @types/react, @types/react-dom, vite, @vitejs/plugin-react, oxlint, @types/react (+3 more)

### Community 33 - "scripts"
Cohesion: 0.06
Nodes (30): oxlint, devDependencies, oxlint, @types/react, @types/react-dom, vite, @vitejs/plugin-react, engines (+22 more)

### Community 34 - "backup.js"
Cohesion: 0.20
Nodes (9): backupDir, dataDir, __dirname, dst, files, now, root, src (+1 more)

### Community 37 - "worker-protocol.cjs"
Cohesion: 0.20
Nodes (15): assert, records, worker, ALLOWED_STATUSES, crypto, isoOrNow(), normalizeAmount(), normalizeInteger() (+7 more)

### Community 38 - "opencode.json"
Cohesion: 0.50
Nodes (3): plugin, $schema, .opencode/plugins/graphify.js

### Community 39 - "portal-scraper.js"
Cohesion: 0.28
Nodes (18): allStrings(), apartmentNumber(), clean(), digits(), field(), json(), loginState(), needsLogin() (+10 more)

### Community 40 - "App.jsx"
Cohesion: 0.22
Nodes (13): react, api, Modal(), Apartments(), Contracts(), Login(), getPredialUrl(), lookupRef() (+5 more)

### Community 42 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 43 - "add-passwords.js"
Cohesion: 0.25
Nodes (6): db, dbCjsPath, dbPath, __dirname, root, seedCopy

### Community 44 - "ScraperWorker.jsx"
Cohesion: 0.23
Nodes (23): DEFAULT_SCHEDULE, formatSchedule(), ScraperWorker(), clearAndroidPortalCookies(), configureAndroidScraperWorker(), getAndroidScraperWorkerStatus(), NativeScraperWorker, openAndroidPortal() (+15 more)

### Community 45 - "Settings.jsx"
Cohesion: 0.23
Nodes (19): Settings(), callerScreeningPlugin(), getAuthorizedSmsMessages(), getCallScreeningStatus(), nativeAndroid(), normalizedPhone(), requestCallScreeningRole(), requestProtectedSmsRole() (+11 more)

### Community 46 - "Gestión de Apartamentos — Laujim APP"
Cohesion: 0.12
Nodes (16): Arquitectura del Sistema, Estructura del Proyecto, Flujo de Datos, Force Desktop Layout (APK + Mobile Web), Funcionamiento, Funciones Principales, Gestión de Apartamentos — Laujim APP, Impuesto Predial (+8 more)

### Community 48 - "generate-version.js"
Cohesion: 0.29
Nodes (5): __dirname, dist, now, verFile, version

### Community 49 - "MainActivity.java"
Cohesion: 0.47
Nodes (4): Bundle, Override, MainActivity, BridgeActivity

### Community 50 - "content-portals.js"
Cohesion: 0.53
Nodes (4): attempt(), fillAndSubmit(), reportError(), showNotice()

### Community 51 - "popup.js"
Cohesion: 0.53
Nodes (5): escapeHtml(), loadData(), loadUrls(), showToast(), updateStatus()

### Community 52 - "deploy-snapshot.cjs"
Cohesion: 0.33
Nodes (5): BACKUP_FILE, DATA_FILE, { execSync }, fs, path

### Community 53 - "seed-data.js"
Cohesion: 0.33
Nodes (5): DATA, dataPath, dbCjsPath, __dirname, now

### Community 54 - "ExampleInstrumentedTest.java"
Cohesion: 0.60
Nodes (3): ExampleInstrumentedTest, Test, RunWith

### Community 55 - "content-laujim.js"
Cohesion: 0.60
Nodes (4): checkAndStore(), sessionFromPage(), storeData(), storeSession()

### Community 56 - "copy-apk.js"
Cohesion: 0.29
Nodes (6): apkDst, apkSrc, __dirname, dist, publicApkDst, publicDir

### Community 57 - "fix-html.js"
Cohesion: 0.40
Nodes (4): __dirname, html, htmlFile, scriptMatch

### Community 58 - "migrate-to-aiven.cjs"
Cohesion: 0.40
Nodes (3): path, { Pool }, { readFileSync }

### Community 59 - "sync-seed.js"
Cohesion: 0.40
Nodes (3): BASE, __dirname, root

### Community 60 - "Historial de Cambios"
Cohesion: 0.12
Nodes (17): 2026-07-20 — v2.1.0 — Chat, dark mode, cloud-first, editor embebido, refactor mayor, 2026-07-20 — v2.1.1 — Fix crítico: carga datos cloud-first (setCollectionData mutación in-place, useState faltante, protección arrays vacíos, reset-db), 2026-07-21 — v2.2.0 — Chat presence fix, Dashboard imprevistos, auto-guardado contratos, campos trabajo inquilinos, 2026-07-22 — v2.3.0 — Temas pastel inmersivos, antecedentes policiales, predial, PostgreSQL, QR escáner, 2026-07-23 — v2.4.0 — Chrome Extension: auto-fill Facebook Marketplace con fotos, 2026-07-23 — v2.4.1 — Extension v1.4.1: fix dropdown menu close race condition + backup, 2026-07-23 — v2.4.2 — Extension v1.4.3: fix address field detection, fix laundry dropdown false match, 2026-07-23 — v2.4.3 — Extension v1.4.4: scope address query to form, reorder laundry options, exclude address field from dropdown search (+9 more)

### Community 61 - "darkMode.js"
Cohesion: 0.80
Nodes (4): applyDarkMode(), initDarkMode(), isDarkMode(), toggleDarkMode()

### Community 63 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 64 - "ScraperWorkerService"
Cohesion: 0.06
Nodes (29): IBinder, Intent, Override, RespondViaMessageService, Context, ScraperWorkerAlarm, CapacitorPlugin, JSObject (+21 more)

### Community 66 - "Extensión de Chrome — Llenar Laujim"
Cohesion: 0.12
Nodes (16): Arquitectura, Backup de referencia, Configuración actual de dropdowns (v1.4.5), Extensión de Chrome — Llenar Laujim, Flujo de `chooseDropdown` (v1.4.5), Gestión de anuncios, Instalación, La app no carga en el navegador (+8 more)

### Community 69 - "pre-whatsapp-bot/package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 70 - "Plan — Cámaras + Timbre QR + Integración Laujim APP"
Cohesion: 0.18
Nodes (10): Arquitectura (resumen), Decisión tomada, Equipos (compra el dueño, obra aparte ~$300), Funcionalidad, Integración en Laujim APP (alcance acordado), Orden de operaciones, Pendientes independientes de este plan, Plan — Cámaras + Timbre QR + Integración Laujim APP (+2 more)

### Community 72 - "cdp-driver.cjs"
Cohesion: 0.60
Nodes (4): findAppPage(), getBrowserWs(), main(), puppeteer

### Community 73 - "2. Modos de ejecución"
Cohesion: 0.18
Nodes (11): 1. Instalar dependencias, 2. Modos de ejecución, 3. Compilar APK Android, 4. Sincronizar Seeds, Build de producción, Desarrollo (red local), Desarrollo (solo este PC), Instalación y Uso (+3 more)

### Community 74 - "cdp-driver.mjs"
Cohesion: 0.83
Nodes (3): findAppPage(), getBrowserWs(), main()

### Community 92 - "graphify-update.cjs"
Cohesion: 0.14
Nodes (12): args, { existsSync, readFileSync }, findPython(), hasGraphify(), { homedir }, { join, dirname }, PROJECT_ROOT, python (+4 more)

### Community 93 - "Configuración Específica por Archivo"
Cohesion: 0.25
Nodes (8): `capacitor.config.json` — Capacitor 8, Configuración Específica por Archivo, `index.html` — Entry Point, `server.cjs` — Servidor Express, `src/App.jsx` — Router e Inicialización, `src/main.jsx` — Bootstrap React, `src/utils/config.js` — Conexión al Servidor, `vite.config.js` — Build & Dev Server

### Community 94 - "scrapeGasAccount"
Cohesion: 0.19
Nodes (22): attachBrowserlessCaptchaSolver(), closeWaterBrowser(), closeWaterResource(), executePortalTurnstile(), fetchPortalJson(), gasInvoiceSummary(), gasRecord(), getPortalCredentials() (+14 more)

### Community 95 - "Sistema de Temas (6 Temas Visuales)"
Cohesion: 0.29
Nodes (7): Componentes, Implementación CSS (`src/index.css`), Persistencia y Sincronización, Regla 60-30-10, Sistema de Temas (6 Temas Visuales), Temas disponibles, Utility classes

### Community 96 - "Construir APK para Android"
Cohesion: 0.33
Nodes (5): Alternativa sin Android Studio (solo CLI), Construir APK para Android, Notas, Pasos, Requisitos

### Community 97 - "API REST Completa"
Cohesion: 0.33
Nodes (6): API REST Completa, Editor API (auth Basic: admin/admin123), Endpoints de Antecedentes (Policía), Endpoints de Archivos, Endpoints Generales, Endpoints Genéricos (CRUD Automático)

### Community 98 - "ThemeSelector.jsx"
Cohesion: 0.32
Nodes (11): iconMap, ThemeSelector(), applyTheme(), getTheme(), getThemeInfo(), initTheme(), loadThemeFromServer(), setTheme() (+3 more)

### Community 99 - "Convertir a APK con Capacitor"
Cohesion: 0.40
Nodes (4): Convertir a APK con Capacitor, Pasos, Requisitos, Requisitos del sistema para compilar APK

### Community 100 - "WhatsApp Business Platform — puesta en marcha"
Cohesion: 0.40
Nodes (4): Configuración en Meta, Operación desde la app, Política de privacidad implementada, WhatsApp Business Platform — puesta en marcha

### Community 101 - "Base de Datos en Memoria"
Cohesion: 0.40
Nodes (5): 13 Colecciones, API por colección, Base de Datos en Memoria, Funciones de manipulación, Seed Data Embebido

### Community 102 - "Servicios Públicos y QR de Pago"
Cohesion: 0.40
Nodes (5): Almacenamiento, Consulta horaria de agua, Escáner QR, Página Utilities (`/utilities`), Servicios Públicos y QR de Pago

### Community 103 - "Datos Iniciales (Seed)"
Cohesion: 0.50
Nodes (4): Apartamentos (12 unidades), Datos Iniciales (Seed), Inquilinos de Prueba (WhatsApp Bot), Usuarios

### Community 104 - "Consulta de Antecedentes (Policía)"
Cohesion: 0.50
Nodes (4): Auto-Check (API Server-Side), Captcha Proxy Flow (Iframe), Consulta de Antecedentes (Policía), Marcado Manual

### Community 105 - "Sistema de Chat"
Cohesion: 0.50
Nodes (4): Componentes, Estados de Presencia, Rooms, Sistema de Chat

### Community 106 - "Persistencia PostgreSQL"
Cohesion: 0.50
Nodes (4): Configuración SSL, Esquema, Flujo, Persistencia PostgreSQL

### Community 107 - "Requerimientos del Sistema"
Cohesion: 0.50
Nodes (4): Dependencias npm (21 production, 5 dev), Para compilar APK (Android), Para desarrollo/web local, Requerimientos del Sistema

### Community 108 - "Sistema de Autenticación"
Cohesion: 0.50
Nodes (4): Login Admin, Login Inquilino, Sesión, Sistema de Autenticación

### Community 109 - "runGasScrapeOnce"
Cohesion: 0.24
Nodes (12): completePortalResults(), enqueueServiceBrowserRun(), isTransientPortalRunError(), persistGasResults(), persistResults(), persistWaterResults(), portalFailureResult(), runGasScrapeOnce() (+4 more)

### Community 111 - "matchPortalApartmentForService"
Cohesion: 0.22
Nodes (10): apartmentNumberFrom(), configuredApartmentTargets(), logUnmatchedPortalItems(), matchPortalApartment(), matchPortalApartmentForService(), normalizeDigits(), normalizePortalText(), portalCodeValues() (+2 more)

### Community 120 - "Worker portatil de servicios"
Cohesion: 0.25
Nodes (7): Android, Cambiar de dispositivo, Configuracion de Render, Contrato HTTP, Objetivo, PC o VPS, Worker portatil de servicios

### Community 122 - "getBase"
Cohesion: 0.12
Nodes (20): getServerVersion(), VersionBanner(), versionIsNewer(), ContractGenerator(), PublicApartment(), serviceIcons, PublicApartments(), ShareApartments() (+12 more)

### Community 123 - "test-water-scraper.cjs"
Cohesion: 0.50
Nodes (3): assert, db, scraper

### Community 126 - "scrapeAirE"
Cohesion: 0.18
Nodes (12): BROWSERLESS_PROFILES, browserlessEndpointCandidates(), browserlessEndpointFor(), configuredAirETargets(), contractFromAirEResources(), firstExistingPath(), getAirECredentials(), gotoPortalPage() (+4 more)

### Community 127 - "PortalBrowserActivity"
Cohesion: 0.30
Nodes (6): Activity, Bundle, Override, WebView, PortalBrowserActivity, TextView

### Community 128 - "Plantillas de WhatsApp Cloud de Laujim"
Cohesion: 0.40
Nodes (4): 1. `saludo_inquilino`, 2. `cobro_canon_servicios`, Plantillas de WhatsApp Cloud de Laujim, Variables de Render

### Community 129 - "_scrape-diagnostic.cjs"
Cohesion: 0.40
Nodes (4): db, fs, path, scraper

### Community 131 - "portable-worker.cjs"
Cohesion: 0.17
Nodes (16): applyRemoteConfig(), chromeProfileDir, config, configPath, fs, loadRemoteConfig(), localDb, main() (+8 more)

### Community 132 - "Plantilla de WhatsApp: cobro_canon_servicios"
Cohesion: 0.50
Nodes (3): Cuerpo para Meta, Orden de variables, Plantilla de WhatsApp: `cobro_canon_servicios`

## Knowledge Gaps
- **496 isolated node(s):** `$schema`, `.opencode/plugins/graphify.js`, `BROWSER_TOOL_PREFIXES`, `$schema`, `oxc` (+491 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **41 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `node-cron`, `@capacitor-mlkit/barcode-scanning`, `@capacitor/cli`, `scripts`, `@capacitor/core`, `@capacitor/share`, `tailwindcss`, `ffmpeg-static`, `recharts`, `@tailwindcss/vite`, `react-dom`, `puppeteer-core`, `jspdf`, `react`, `pg`, `multer`, `@sparticuz/chromium`, `lucide-react`, `@capacitor/local-notifications`, `@capacitor/filesystem`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `jspdf` connect `jspdf` to `dependencies`, `contractGenerator.js`, `ApartmentDetail.jsx`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `portalFieldValue()` connect `scrapeGasAccount` to `matchPortalApartmentForService`, `portal-scraper.js`, `services-scraper.cjs`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `$schema`, `.opencode/plugins/graphify.js`, `BROWSER_TOOL_PREFIXES` to the rest of the system?**
  _496 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ApartmentDetail.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07505827505827506 - nodes in this community are weakly interconnected._
- **Should `.status` be split into smaller, more focused modules?**
  _Cohesion score 0.11193339500462535 - nodes in this community are weakly interconnected._
- **Should `server.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05142857142857143 - nodes in this community are weakly interconnected._