# Graph Report - Proyecto Laujim APP fix  (2026-08-06)

## Corpus Check
- 118 files · ~139,928 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1126 nodes · 2067 edges · 112 communities (88 shown, 24 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `83ea8c01`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Settings.jsx
- ApartmentDetail.jsx
- .status
- server.cjs
- pre-whatsapp-bot/server.cjs
- _head_server.cjs
- extension/manifest.json
- startServer
- @capacitor/android
- chat.js
- dependencies
- api.js
- handleCloudInbound
- .messages
- content-facebook.js
- calendar.js
- ErrorBoundary
- App.jsx
- react
- Arquitectura del Sistema
- getR2Client
- 5. ESPECIFICACIÓN DE INTEGRACIÓN (LO QUE CODEX DEBE CONSTRUIR)
- cloudApiRequest
- services-scraper.cjs
- contractGenerator.js
- setup-graphify-hooks.cjs
- runPaymentReminders
- public/manifest.json
- auth.js
- ThemeSelector.jsx
- graphify.js
- dependencies
- scripts
- scripts
- backup.js
- callScreening.js
- package.json
- Predial.jsx
- opencode.json
- devDependencies
- jsqr
- tailwindcss
- .oxlintrc.json
- add-passwords.js
- RespondViaMessageService.java
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
- clipboard.js
- Extensión de Chrome — Llenar Laujim
- @capacitor-mlkit/barcode-scanning
- Plan — Cámaras + Timbre QR + Integración Laujim APP
- react-dom
- 2. Modos de ejecución
- background.js
- pre-commit
- sw.js
- graphify-update.cjs
- Configuración Específica por Archivo
- Sistema de Temas (6 Temas Visuales)
- Construir APK para Android
- API REST Completa
- @capacitor/local-notifications
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
- @capacitor/core
- cors
- dexie
- multer
- pg
- puppeteer-core
- @sparticuz/chromium
- jspdf
- lucide-react
- react

## God Nodes (most connected - your core abstractions)
1. `startServer()` - 46 edges
2. `startServer()` - 45 edges
3. `getBase()` - 33 edges
4. `react` - 26 edges
5. `handleCloudInbound()` - 25 edges
6. `handleCloudInbound()` - 25 edges
7. `Gestión de Apartamentos — Laujim APP` - 25 edges
8. `getAuth()` - 20 edges
9. `AuthorizedCallerPlugin` - 17 edges
10. `formatCurrency()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `CustomTooltip()` --calls--> `formatCurrency()`  [EXTRACTED]
  src/components/PaymentHistoryChart.jsx → src/utils/helpers.js
- `ProtectedRoute()` --calls--> `getAuth()`  [EXTRACTED]
  src/App.jsx → src/utils/auth.js
- `AdminRoute()` --calls--> `getAuth()`  [EXTRACTED]
  src/App.jsx → src/utils/auth.js
- `PrivateApp()` --calls--> `getAuth()`  [EXTRACTED]
  src/App.jsx → src/utils/auth.js
- `PrivateApp()` --calls--> `syncAuthorizedCallerNumbers()`  [EXTRACTED]
  src/App.jsx → src/utils/callScreening.js

## Import Cycles
- None detected.

## Communities (112 total, 24 thin omitted)

### Community 0 - "Settings.jsx"
Cohesion: 0.18
Nodes (14): Layout(), navItems, Settings(), cancelAllNotifications(), getNotifConfig(), saveNotifConfig(), schedulePaymentReminders(), generateBookmarkletCode() (+6 more)

### Community 1 - "ApartmentDetail.jsx"
Cohesion: 0.11
Nodes (25): COLORS, CustomTooltip(), getChartData(), getPaymentStatus(), PaymentHistoryChart(), StatsCard(), ApartmentDetail(), serviceColors (+17 more)

### Community 2 - ".status"
Cohesion: 0.11
Nodes (16): ActivityCallback, ActivityResult, AuthorizedCallerPlugin, AuthorizedCallerScreeningService, Override, AuthorizedCallerStore, Context, SharedPreferences (+8 more)

### Community 3 - "server.cjs"
Cohesion: 0.05
Nodes (102): INITIAL_DATA, activeContractForApartment(), addCloudMessage(), app, archiveCloudInboundMedia(), authorizedCloudContact(), BACKUP_DIR, BACKUP_FILE (+94 more)

### Community 4 - "pre-whatsapp-bot/server.cjs"
Cohesion: 0.08
Nodes (31): INITIAL_DATA, app, BACKUP_DIR, BACKUP_FILE, CONTRACTS_DIR, cors, DATA_DIR, DATA_FILE (+23 more)

### Community 5 - "_head_server.cjs"
Cohesion: 0.06
Nodes (35): app, BACKUP_DIR, BACKUP_FILE, CONTRACTS_DIR, cors, crypto, DATA_DIR, DATA_FILE (+27 more)

### Community 6 - "extension/manifest.json"
Cohesion: 0.07
Nodes (29): action, default_icon, default_popup, default_title, background, service_worker, content_scripts, 128 (+21 more)

### Community 7 - "startServer"
Cohesion: 0.15
Nodes (22): cloudMediaKind(), cloudPeriodLabel(), constantTimeEqual(), createAuthSession(), ensureAuthSessions(), firstName(), getAuthSession(), getDatabaseUsage() (+14 more)

### Community 9 - "chat.js"
Cohesion: 0.23
Nodes (20): AdminRoute(), ProtectedRoute(), Chat(), getAuth(), isAdmin(), requireAuth(), fetchPresence(), getAllRooms() (+12 more)

### Community 10 - "dependencies"
Cohesion: 0.05
Nodes (43): dependencies, @capacitor/android, @capacitor/cli, @capacitor/core, @capacitor/local-notifications, @capacitor-mlkit/barcode-scanning, @capacitor/share, cors (+35 more)

### Community 11 - "api.js"
Cohesion: 0.15
Nodes (20): CLOUD_COLLECTIONS, createItem(), deleteItem(), getDataVersion(), refreshAllFromServer(), serverReq(), startCloudPolling(), startDataVersionPolling() (+12 more)

### Community 12 - "handleCloudInbound"
Cohesion: 0.22
Nodes (21): authorizedCloudContact(), blockCloudUser(), clearCloudAuthState(), cloudInboundMedia(), cloudInteractiveReply(), ensureCloudCollections(), failCloudAuthentication(), getCloudAuthState() (+13 more)

### Community 13 - ".messages"
Cohesion: 0.15
Nodes (13): AuthorizedMmsReceiver, Context, Intent, Override, AuthorizedSmsReceiver, Context, Intent, Override (+5 more)

### Community 14 - "content-facebook.js"
Cohesion: 0.25
Nodes (22): activate(), autoFill(), checkAndRun(), chooseDropdown(), fillAndConfirmAddress(), fillAndConfirmAddressReliable(), findAndSet(), findDropdown() (+14 more)

### Community 15 - "calendar.js"
Cohesion: 0.38
Nodes (10): addCalendarReminder(), downloadICS(), fmtDate(), generateAllPaymentReminders(), generateICS(), getStoredUIDs(), nextDueDate(), saveStoredUIDs() (+2 more)

### Community 17 - "App.jsx"
Cohesion: 0.13
Nodes (20): getServerVersion(), uploadFile(), VersionBanner(), versionIsNewer(), ContractGenerator(), PublicApartment(), serviceIcons, PublicApartments() (+12 more)

### Community 18 - "react"
Cohesion: 0.23
Nodes (14): react, api, Modal(), Apartments(), Contracts(), Login(), Payments(), Reports() (+6 more)

### Community 19 - "Arquitectura del Sistema"
Cohesion: 0.67
Nodes (3): Arquitectura del Sistema, Flujo de Datos, Viewport y Layout Adaptativo

### Community 20 - "getR2Client"
Cohesion: 0.42
Nodes (10): deleteR2Object(), ensureR2Usage(), getR2Client(), getR2Usage(), putR2Buffer(), r2Config(), r2Key(), r2Ready() (+2 more)

### Community 21 - "5. ESPECIFICACIÓN DE INTEGRACIÓN (LO QUE CODEX DEBE CONSTRUIR)"
Cohesion: 0.07
Nodes (27): 1.1 Identidad, 1.2 Stack (verificado en package.json + README), 1.3 Autenticación, 1.4 Colecciones existentes (13 núcleo), 1.5 Datos relevantes por apartamento, 1.6 Puntos de extensión existentes (patrones a imitar), 1. ESTADO ACTUAL DE LA APP, 2. LIMITACIONES DE HARDWARE / INFRAESTRUCTURA (CRÍTICAS) (+19 more)

### Community 22 - "cloudApiRequest"
Cohesion: 0.33
Nodes (9): archiveCloudInboundMedia(), cloudApiRequest(), cloudConfig(), cloudGraphRequest(), cloudReady(), downloadCloudMedia(), sendCloudMedia(), uploadCloudMedia() (+1 more)

### Community 23 - "services-scraper.cjs"
Cohesion: 0.18
Nodes (14): AIR_E_NIC_MAP, AIR_E_URLS, CHROME_CANDIDATES, cron, fs, getAirECredentials(), launchBrowser(), persistResults() (+6 more)

### Community 24 - "contractGenerator.js"
Cohesion: 0.17
Nodes (13): centenasALetras(), CIENTOS, CLAUSULAS, DECENAS, ESPECIALES, fechaEnLetras(), generateContractPDF(), limpiarNumero() (+5 more)

### Community 25 - "setup-graphify-hooks.cjs"
Cohesion: 0.25
Nodes (7): DST, { existsSync, copyFileSync, mkdirSync, chmodSync }, GIT_DIR, HOOKS_DIR, { join, dirname }, ROOT, SRC

### Community 26 - "runPaymentReminders"
Cohesion: 0.32
Nodes (8): activeContractForApartment(), addCloudMessage(), colombiaDate(), createPendingPaymentFromProof(), paymentCountsAsCollected(), paymentPeriod(), paymentReminderOffsets(), runPaymentReminders()

### Community 27 - "public/manifest.json"
Cohesion: 0.14
Nodes (13): background_color, categories, description, display, icons, name, orientation, screenshots (+5 more)

### Community 28 - "auth.js"
Cohesion: 0.27
Nodes (12): stopCloudPolling(), stopDataVersionPolling(), MiApto(), clearAuth(), getTenantApartmentId(), isTenant(), login(), loginAdmin() (+4 more)

### Community 29 - "ThemeSelector.jsx"
Cohesion: 0.32
Nodes (11): iconMap, ThemeSelector(), applyTheme(), getTheme(), getThemeInfo(), initTheme(), loadThemeFromServer(), setTheme() (+3 more)

### Community 31 - "dependencies"
Cohesion: 0.10
Nodes (21): @aws-sdk/client-s3, @capacitor/filesystem, node-cron, dependencies, @aws-sdk/client-s3, @capacitor/cli, @capacitor/filesystem, @capacitor/share (+13 more)

### Community 32 - "scripts"
Cohesion: 0.07
Nodes (27): devDependencies, oxlint, @types/react, @types/react-dom, vite, @vitejs/plugin-react, engines, node (+19 more)

### Community 33 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, backup, build, build-apk, dev, graphify, lint, network (+3 more)

### Community 34 - "backup.js"
Cohesion: 0.20
Nodes (9): backupDir, dataDir, __dirname, dst, files, now, root, src (+1 more)

### Community 35 - "callScreening.js"
Cohesion: 0.55
Nodes (10): callerScreeningPlugin(), getAuthorizedSmsMessages(), getCallScreeningStatus(), nativeAndroid(), normalizedPhone(), requestCallScreeningRole(), requestProtectedSmsRole(), setAllowCallsFromContacts() (+2 more)

### Community 36 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 37 - "Predial.jsx"
Cohesion: 0.60
Nodes (4): getPredialUrl(), lookupRef(), Predial(), REF_MAP

### Community 38 - "opencode.json"
Cohesion: 0.50
Nodes (3): plugin, $schema, .opencode/plugins/graphify.js

### Community 39 - "devDependencies"
Cohesion: 0.18
Nodes (11): devDependencies, oxlint, @types/react, @types/react-dom, vite, @vitejs/plugin-react, oxlint, @types/react (+3 more)

### Community 42 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 43 - "add-passwords.js"
Cohesion: 0.25
Nodes (6): db, dbCjsPath, dbPath, __dirname, root, seedCopy

### Community 45 - "RespondViaMessageService.java"
Cohesion: 0.43
Nodes (5): Intent, Override, RespondViaMessageService, IBinder, Service

### Community 46 - "Gestión de Apartamentos — Laujim APP"
Cohesion: 0.14
Nodes (13): Estructura del Proyecto, Force Desktop Layout (APK + Mobile Web), Funcionamiento, Funciones Principales, Gestión de Apartamentos — Laujim APP, Impuesto Predial, Notificaciones, Notificaciones del Navegador (`src/utils/notifications.js`) (+5 more)

### Community 48 - "generate-version.js"
Cohesion: 0.29
Nodes (5): __dirname, dist, now, verFile, version

### Community 49 - "MainActivity.java"
Cohesion: 0.47
Nodes (4): Override, MainActivity, BridgeActivity, Bundle

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
Cohesion: 0.40
Nodes (4): apkDst, apkSrc, __dirname, dist

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
Nodes (16): 2026-07-20 — v2.1.0 — Chat, dark mode, cloud-first, editor embebido, refactor mayor, 2026-07-20 — v2.1.1 — Fix crítico: carga datos cloud-first (setCollectionData mutación in-place, useState faltante, protección arrays vacíos, reset-db), 2026-07-21 — v2.2.0 — Chat presence fix, Dashboard imprevistos, auto-guardado contratos, campos trabajo inquilinos, 2026-07-22 — v2.3.0 — Temas pastel inmersivos, antecedentes policiales, predial, PostgreSQL, QR escáner, 2026-07-23 — v2.4.0 — Chrome Extension: auto-fill Facebook Marketplace con fotos, 2026-07-23 — v2.4.1 — Extension v1.4.1: fix dropdown menu close race condition + backup, 2026-07-23 — v2.4.2 — Extension v1.4.3: fix address field detection, fix laundry dropdown false match, 2026-07-23 — v2.4.3 — Extension v1.4.4: scope address query to form, reorder laundry options, exclude address field from dropdown search (+8 more)

### Community 61 - "darkMode.js"
Cohesion: 0.80
Nodes (4): applyDarkMode(), initDarkMode(), isDarkMode(), toggleDarkMode()

### Community 63 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 66 - "Extensión de Chrome — Llenar Laujim"
Cohesion: 0.12
Nodes (16): Arquitectura, Backup de referencia, Configuración actual de dropdowns (v1.4.5), Extensión de Chrome — Llenar Laujim, Flujo de `chooseDropdown` (v1.4.5), Gestión de anuncios, Instalación, La app no carga en el navegador (+8 more)

### Community 70 - "Plan — Cámaras + Timbre QR + Integración Laujim APP"
Cohesion: 0.18
Nodes (10): Arquitectura (resumen), Decisión tomada, Equipos (compra el dueño, obra aparte ~$300), Funcionalidad, Integración en Laujim APP (alcance acordado), Orden de operaciones, Pendientes independientes de este plan, Plan — Cámaras + Timbre QR + Integración Laujim APP (+2 more)

### Community 73 - "2. Modos de ejecución"
Cohesion: 0.18
Nodes (11): 1. Instalar dependencias, 2. Modos de ejecución, 3. Compilar APK Android, 4. Sincronizar Seeds, Build de producción, Desarrollo (red local), Desarrollo (solo este PC), Instalación y Uso (+3 more)

### Community 92 - "graphify-update.cjs"
Cohesion: 0.18
Nodes (9): args, CANDIDATES, { existsSync }, { homedir }, { join, dirname }, PROJECT_ROOT, res, ROOT (+1 more)

### Community 93 - "Configuración Específica por Archivo"
Cohesion: 0.25
Nodes (8): `capacitor.config.json` — Capacitor 8, Configuración Específica por Archivo, `index.html` — Entry Point, `server.cjs` — Servidor Express, `src/App.jsx` — Router e Inicialización, `src/main.jsx` — Bootstrap React, `src/utils/config.js` — Conexión al Servidor, `vite.config.js` — Build & Dev Server

### Community 95 - "Sistema de Temas (6 Temas Visuales)"
Cohesion: 0.29
Nodes (7): Componentes, Implementación CSS (`src/index.css`), Persistencia y Sincronización, Regla 60-30-10, Sistema de Temas (6 Temas Visuales), Temas disponibles, Utility classes

### Community 96 - "Construir APK para Android"
Cohesion: 0.33
Nodes (5): Alternativa sin Android Studio (solo CLI), Construir APK para Android, Notas, Pasos, Requisitos

### Community 97 - "API REST Completa"
Cohesion: 0.33
Nodes (6): API REST Completa, Editor API (auth Basic: admin/admin123), Endpoints de Antecedentes (Policía), Endpoints de Archivos, Endpoints Generales, Endpoints Genéricos (CRUD Automático)

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
Cohesion: 0.50
Nodes (4): Almacenamiento, Escáner QR, Página Utilities (`/utilities`), Servicios Públicos y QR de Pago

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

## Knowledge Gaps
- **427 isolated node(s):** `$schema`, `.opencode/plugins/graphify.js`, `$schema`, `oxc`, `react/rules-of-hooks` (+422 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `react` to `Settings.jsx`, `ApartmentDetail.jsx`, `Predial.jsx`, `chat.js`, `.oxlintrc.json`, `ErrorBoundary`, `App.jsx`, `auth.js`, `ThemeSelector.jsx`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `@capacitor/local-notifications`, `package.json`, `@capacitor-mlkit/barcode-scanning`, `react-dom`, `@capacitor/android`, `jsqr`, `tailwindcss`, `@capacitor/core`, `ffmpeg-static`, `cors`, `dexie`, `multer`, `pg`, `puppeteer-core`, `@sparticuz/chromium`, `jspdf`, `lucide-react`, `react`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `getBase()` connect `App.jsx` to `Settings.jsx`, `ApartmentDetail.jsx`, `chat.js`, `api.js`, `react`, `auth.js`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `$schema`, `.opencode/plugins/graphify.js`, `$schema` to the rest of the system?**
  _427 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ApartmentDetail.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11470985155195682 - nodes in this community are weakly interconnected._
- **Should `.status` be split into smaller, more focused modules?**
  _Cohesion score 0.10904255319148937 - nodes in this community are weakly interconnected._
- **Should `server.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.050597460791635546 - nodes in this community are weakly interconnected._