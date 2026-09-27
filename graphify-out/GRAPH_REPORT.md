# Graph Report - Proyecto Laujim APP fix  (2026-09-26)

## Corpus Check
- 174 files · ~243,266 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1826 nodes · 3984 edges · 180 communities (130 shown, 50 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 92 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4ab4ab2e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.cjs
- ErrorBoundary
- config.js
- saveData
- services-scraper.cjs
- truecaller-smoke.cjs
- handleCloudInbound
- ApartmentDetail.jsx
- _head_server.cjs
- scripts
- getBase
- cloudServiceAmounts
- createCloudServicesReportMedia
- extension/manifest.json
- App.jsx
- getAuth
- worker-protocol.cjs
- post
- truecaller-request-otp.cjs
- payment-receipt-ocr.cjs
- sleep
- content-facebook.js
- handleCloudInbound
- startServer
- backup-media-s3.cjs
- dependencies
- portable-worker.cjs
- contractGenerator.js
- scrapeTripleAFromRenderedUi
- runGasScrapeOnce
- graphify-update.cjs
- public/manifest.json
- build-apk.cjs
- generate-version.js
- auth.js
- release-apk.cjs
- saveData
- test-marketplace-api.cjs
- check-secrets.cjs
- getR2Client
- backup.js
- setup-graphify-hooks.cjs
- sync-aiven-before-push.cjs
- test-water-scraper.cjs
- .oxlintrc.json
- add-passwords.js
- archive-graph.cjs
- startServer
- matchPortalApartmentForService
- 2. Paso a Paso de la Migración
- runPaymentReminders
- content-portals.js
- popup.js
- copy-apk.js
- deploy-snapshot.cjs
- seed-data.js
- content-laujim.js
- fix-html.js
- migrate-to-aiven.cjs
- sync-seed.js
- scrapeGasFromRenderedUi
- darkMode.js
- clipboard.js
- background.js
- prepare-capacitor-assets.js
- Gestión de Apartamentos — Laujim APP
- colombiaDate
- set-camera-codes.cjs
- isCapacitor
- notifyPaymentAssociationRequired
- Utilities.jsx
- IntercomDoorbell.jsx
- deploy_temp.sh
- install-vm.sh
- waitForRenderedPortal
- pre-commit
- pre-push
- sync-db-aiven.sh
- express
- _stream_supervisor
- truecaller-verify-otp.cjs
- caller-id-repository.cjs
- test_chrome.cjs
- react-dom
- scan_plates_cloud
- puppeteer-core
- test_chrome.js
- dexie
- ezviz_stream_server.py
- sw.js
- Historial de Cambios
- Extensión de Chrome — Llenar Laujim
- get
- set-local-pass.cjs
- jsqr
- 2. Modos de ejecución
- lucide-react
- @capacitor/android
- Configuración Específica por Archivo
- Sistema de Temas (6 Temas Visuales)
- Construir APK para Android
- API REST Completa
- Convertir a APK con Capacitor
- diag-video.sh
- Base de Datos en Memoria
- Servicios Públicos y QR de Pago
- Datos Iniciales (Seed)
- Consulta de Antecedentes (Policía)
- Sistema de Chat
- Requerimientos del Sistema
- Sistema de Autenticación
- _run_export_multi_job
- VehicleStationaryTracker
- docker-start-render.sh
- capture-proposal.cjs
- multer
- generate-proposal.cjs
- pizzip
- @capacitor/core
- react
- pg-set-admin.cjs
- @tailwindcss/vite
- truecallerjs
- test_ml_pipeline.py
- @sparticuz/chromium
- pg-verify.cjs
- b64u
- xvfb-smoke.cjs
- Persistencia PostgreSQL
- ffmpeg-static
- ThemeSelector.jsx
- api
- @capacitor/filesystem
- set-admin-pass.cjs
- verify-admin.cjs
- @capacitor/local-notifications
- @capacitor-mlkit/barcode-scanning
- @capacitor/share
- docxtemplater
- pg-del-hash.cjs
- pg-where.cjs
- probe-stdin.cjs
- hls.js
- libphonenumber-js
- node-cron
- react-router-dom
- tailwindcss
- scrapeAirE
- calendar.js
- handoff.cjs
- authorizedCloudContact

## God Nodes (most connected - your core abstractions)
1. `startServer()` - 100 edges
2. `startServer()` - 49 edges
3. `getBase()` - 49 edges
4. `handleCloudInbound()` - 42 edges
5. `saveData()` - 40 edges
6. `handleCloudAdminMessage()` - 38 edges
7. `react` - 34 edges
8. `getAuth()` - 29 edges
9. `handleCloudInbound()` - 25 edges
10. `sendCloudText()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `startServer()` --calls--> `getCallerCache()`  [EXTRACTED]
  server.cjs → lib/caller-id/caller-id-repository.cjs
- `startServer()` --calls--> `getLatestJob()`  [EXTRACTED]
  server.cjs → lib/caller-id/caller-id-repository.cjs
- `startServer()` --indirect_call--> `log()`  [INFERRED]
  server.cjs → extension/content-facebook.js
- `startServer()` --calls--> `init()`  [EXTRACTED]
  _head_server.cjs → services-scraper.cjs
- `startServer()` --calls--> `scrapeAirE()`  [EXTRACTED]
  _head_server.cjs → services-scraper.cjs

## Import Cycles
- None detected.

## Communities (180 total, 50 thin omitted)

### Community 0 - "server.cjs"
Cohesion: 0.03
Nodes (80): accessRateLimits, adminPasswordMatches(), { analysePaymentProofMedia, ocrSummary }, app, automaticPaymentPeriod(), automaticPaymentTenantName(), BACKUP_DIR, BACKUP_FILE (+72 more)

### Community 2 - "config.js"
Cohesion: 0.06
Nodes (91): init(), Layout(), navItems, readInstalledAndroidVersion(), triggerNativeUpdateNotification(), VersionBanner(), versionIsNewer(), DEFAULT_SCHEDULE (+83 more)

### Community 3 - "saveData"
Cohesion: 0.16
Nodes (38): activeTenantForApartment(), clearCloudAuthState(), cloudAdminGreeting(), cloudApartmentsForFloor(), cloudFindApartment(), cloudFormatFullDate(), cloudListSections(), cloudPaymentResultLine() (+30 more)

### Community 4 - "services-scraper.cjs"
Cohesion: 0.07
Nodes (31): AIR_E_NIC_MAP, AIR_E_URLS, BROWSERLESS_REGION, BROWSERLESS_SOLVE_CAPTCHAS, BROWSERLESS_STEALTH, BROWSERLESS_TIMEOUT_MS, BROWSERLESS_TOKENS, BROWSERLESS_WS_ENDPOINT (+23 more)

### Community 5 - "truecaller-smoke.cjs"
Cohesion: 0.14
Nodes (12): normalizePhone(), CallerIdProviderError, firstFiniteNumber(), https, normalizeNullableText(), parseTruecallerHtml(), TruecallerProvider, fs (+4 more)

### Community 6 - "handleCloudInbound"
Cohesion: 0.10
Nodes (46): ocrSummary(), acknowledgePaymentProof(), addCloudMessage(), blockCloudUser(), buildCloudServicesImageData(), cloudAdminPaymentReminderTemplateName(), cloudApiRequest(), cloudInboundMedia() (+38 more)

### Community 7 - "ApartmentDetail.jsx"
Cohesion: 0.08
Nodes (35): Modal(), COLORS, CustomTooltip(), getChartData(), getPaymentStatus(), PaymentHistoryChart(), StatsCard(), ApartmentDetail() (+27 more)

### Community 8 - "_head_server.cjs"
Cohesion: 0.06
Nodes (36): INITIAL_DATA, app, BACKUP_DIR, BACKUP_FILE, CONTRACTS_DIR, cors, crypto, DATA_DIR (+28 more)

### Community 9 - "scripts"
Cohesion: 0.05
Nodes (36): oxlint, devDependencies, oxlint, playwright, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+28 more)

### Community 10 - "getBase"
Cohesion: 0.10
Nodes (26): react, getServerVersion(), Admin(), dayKey(), fmtBytes(), fmtDate(), Apartments(), Onboarding() (+18 more)

### Community 11 - "cloudServiceAmounts"
Cohesion: 0.16
Nodes (29): buildDebtReply(), clearUtilityFinancing(), cloudServiceAmounts(), cloudServiceDisplayBlock(), cloudServiceReference(), cloudServiceState(), gasRecordHasNoVisibleInvoice(), latestUtilityRecord() (+21 more)

### Community 12 - "createCloudServicesReportMedia"
Cohesion: 0.19
Nodes (20): cloudFinancingReportHtml(), cloudImageMoney(), cloudServicesReportHtml(), createCloudFinancingReportMedia(), createCloudServicesReportMedia(), deleteR2Object(), ensureR2Usage(), escapeCloudImageHtml() (+12 more)

### Community 13 - "extension/manifest.json"
Cohesion: 0.07
Nodes (29): action, default_icon, default_popup, default_title, background, service_worker, content_scripts, 128 (+21 more)

### Community 14 - "App.jsx"
Cohesion: 0.09
Nodes (38): CLOUD_COLLECTIONS, createItem(), currentAuthToken(), deleteItem(), getCloudSyncStatus(), getDataVersion(), lastCloudSyncStatus, markLocalMutation() (+30 more)

### Community 15 - "getAuth"
Cohesion: 0.25
Nodes (19): AdminRoute(), ProtectedRoute(), Chat(), getAuth(), requireAuth(), fetchPresence(), getAllRooms(), getRoomMessages() (+11 more)

### Community 16 - "worker-protocol.cjs"
Cohesion: 0.18
Nodes (23): assert, records, worker, ALLOWED_STATUSES, crypto, gasContractPaymentUrl(), inspectWorkerResults(), isoOrNow() (+15 more)

### Community 17 - "post"
Cohesion: 0.22
Nodes (11): BaseModel, export_recording(), export_recording_multi(), ExportMultiRequest, ExportRequest, parse_to_rtsp_ts(), ping_stream(), Retorna instantáneamente (<0.1s) la playlist HLS activa. (+3 more)

### Community 18 - "truecaller-request-otp.cjs"
Cohesion: 0.40
Nodes (3): fs, path, truecaller

### Community 19 - "payment-receipt-ocr.cjs"
Cohesion: 0.18
Nodes (24): pdf-parse, amountCandidates(), analysePaymentProofMedia(), analyseText(), detectProvider(), extractDate(), extractPdfScreenshots(), extractPdfText() (+16 more)

### Community 20 - "sleep"
Cohesion: 0.16
Nodes (26): clickVisibleButton(), clickVisiblePortalButtonByText(), executePortalTurnstile(), getPortalCredentials(), gotoPortalPage(), inspectWaterPage(), loginGasWithPortalApi(), loginPortalPage() (+18 more)

### Community 21 - "content-facebook.js"
Cohesion: 0.25
Nodes (22): activate(), autoFill(), checkAndRun(), chooseDropdown(), fillAndConfirmAddress(), fillAndConfirmAddressReliable(), findAndSet(), findDropdown() (+14 more)

### Community 22 - "handleCloudInbound"
Cohesion: 0.22
Nodes (21): addCloudMessage(), authorizedCloudContact(), blockCloudUser(), clearCloudAuthState(), cloudInboundMedia(), cloudInteractiveReply(), ensureCloudCollections(), failCloudAuthentication() (+13 more)

### Community 23 - "startServer"
Cohesion: 0.16
Nodes (21): archiveCloudInboundMedia(), cloudApiRequest(), cloudConfig(), cloudGraphRequest(), cloudMediaKind(), cloudPeriodLabel(), cloudReady(), downloadCloudMedia() (+13 more)

### Community 24 - "backup-media-s3.cjs"
Cohesion: 0.28
Nodes (8): fs, main(), path, r2Config(), root, { S3Client, ListObjectsV2Command, PutObjectCommand }, SOURCES, walk()

### Community 25 - "dependencies"
Cohesion: 0.11
Nodes (19): @aws-sdk/client-s3, better-sqlite3, @capacitor/cli, cors, dependencies, @aws-sdk/client-s3, better-sqlite3, @capacitor/cli (+11 more)

### Community 26 - "portable-worker.cjs"
Cohesion: 0.16
Nodes (17): applyRemoteConfig(), chromeProfileDir, config, configPath, fs, loadRemoteConfig(), localDb, main() (+9 more)

### Community 27 - "contractGenerator.js"
Cohesion: 0.14
Nodes (15): jspdf, jspdf, centenasALetras(), CIENTOS, CLAUSULAS, DECENAS, ESPECIALES, fechaEnLetras() (+7 more)

### Community 28 - "scrapeTripleAFromRenderedUi"
Cohesion: 0.18
Nodes (23): aggregateAirEInvoices(), fetchGasDebtSummary(), fetchPortalJson(), fetchTripleAPortalSummary(), gasDebtSummary(), gasInvoiceSummary(), normalizePortalText(), parsePortalAmount() (+15 more)

### Community 29 - "runGasScrapeOnce"
Cohesion: 0.22
Nodes (14): completePortalResults(), enqueueServiceBrowserRun(), isTransientPortalRunError(), notifyPersistedUtilityChanges(), persistGasResults(), persistResults(), persistUtilityResults(), persistWaterResults() (+6 more)

### Community 30 - "graphify-update.cjs"
Cohesion: 0.14
Nodes (12): args, { existsSync, readFileSync }, findPython(), hasGraphify(), { homedir }, { join, dirname }, PROJECT_ROOT, python (+4 more)

### Community 31 - "public/manifest.json"
Cohesion: 0.14
Nodes (13): background_color, categories, description, display, icons, name, orientation, screenshots (+5 more)

### Community 32 - "build-apk.cjs"
Cohesion: 0.14
Nodes (14): addCandidate(), androidCandidates, androidHome, apkPath, env, { execFileSync, spawnSync }, findJdk21(), fs (+6 more)

### Community 33 - "generate-version.js"
Cohesion: 0.15
Nodes (11): androidGradle, apkVersion, appVersion, __dirname, dist, now, publicDir, publicVersionFile (+3 more)

### Community 34 - "auth.js"
Cohesion: 0.09
Nodes (40): stopCloudPolling(), stopDataVersionPolling(), BUILDING_CAMERAS, IntercomCallModal(), intercomRequest(), BUILDING_CAMERAS, colombiaTime(), IntercomCallPage() (+32 more)

### Community 35 - "release-apk.cjs"
Cohesion: 0.23
Nodes (11): bumpVersion(), fs, gradleFile, main(), path, readVersion(), root, run() (+3 more)

### Community 36 - "saveData"
Cohesion: 0.24
Nodes (11): constantTimeEqual(), createAuthSession(), ensureAuthSessions(), getAuthSession(), loadData(), pruneAuthSessions(), recalcNextId(), removeAuthSession() (+3 more)

### Community 37 - "test-marketplace-api.cjs"
Cohesion: 0.22
Nodes (10): child, fs, os, path, project, request(), run(), { spawn } (+2 more)

### Community 38 - "check-secrets.cjs"
Cohesion: 0.40
Nodes (3): missingRequired, OPTIONAL, REQUIRED

### Community 39 - "getR2Client"
Cohesion: 0.42
Nodes (10): deleteR2Object(), ensureR2Usage(), getR2Client(), getR2Usage(), putR2Buffer(), r2Config(), r2Key(), r2Ready() (+2 more)

### Community 40 - "backup.js"
Cohesion: 0.20
Nodes (9): backupDir, dataDir, __dirname, dst, files, now, root, src (+1 more)

### Community 41 - "setup-graphify-hooks.cjs"
Cohesion: 0.20
Nodes (9): DST, { existsSync, copyFileSync, mkdirSync, chmodSync }, GIT_DIR, HOOKS_DIR, { join, dirname }, PRE_PUSH_DST, PRE_PUSH_SRC, ROOT (+1 more)

### Community 42 - "sync-aiven-before-push.cjs"
Cohesion: 0.24
Nodes (9): collectionCount(), DATA_FILE, { execFileSync }, fs, localDataChanged(), path, { Pool }, ROOT (+1 more)

### Community 43 - "test-water-scraper.cjs"
Cohesion: 0.20
Nodes (9): airSummary, assert, db, financing, gasSummary, gasWithAgreement, scraper, splitTripleSummary (+1 more)

### Community 44 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 45 - "add-passwords.js"
Cohesion: 0.25
Nodes (6): db, dbCjsPath, dbPath, __dirname, root, seedCopy

### Community 46 - "archive-graph.cjs"
Cohesion: 0.25
Nodes (6): archiveDir, fs, graphFile, path, root, zlib

### Community 47 - "startServer"
Cohesion: 0.07
Nodes (43): accessRateAllowed(), appendAccessEvent(), archiveCloudInboundMedia(), automaticPaymentIsRentOnly(), cameraDefinitions(), cloudConfig(), cloudGraphRequest(), cloudMediaKind() (+35 more)

### Community 48 - "matchPortalApartmentForService"
Cohesion: 0.33
Nodes (7): logUnmatchedPortalItems(), matchPortalApartment(), matchPortalApartmentForService(), normalizeDigits(), portalCodeValues(), portalDiagnosticReferences(), portalIdentifierValues()

### Community 49 - "2. Paso a Paso de la Migración"
Cohesion: 0.18
Nodes (10): 1. Datos de tu Servidor Oracle VM, 2. Paso a Paso de la Migración, 3. Resumen de Ventajas Obtenidas, GUÍA COMPLETA DE MIGRACIÓN: RENDER -> ORACLE VM ALWAYS FREE (149.130.160.116), PASO 1: Conectarse a la VM, PASO 2: Sincronizar los archivos del proyecto a la VM, PASO 3: Ejecutar el Instalador Automático, PASO 4: Configuración en Cloudflare (Dominio y SSL) (+2 more)

### Community 50 - "runPaymentReminders"
Cohesion: 0.38
Nodes (7): activeContractForApartment(), colombiaDate(), createPendingPaymentFromProof(), paymentCountsAsCollected(), paymentPeriod(), paymentReminderOffsets(), runPaymentReminders()

### Community 51 - "content-portals.js"
Cohesion: 0.53
Nodes (4): attempt(), fillAndSubmit(), reportError(), showNotice()

### Community 52 - "popup.js"
Cohesion: 0.53
Nodes (5): escapeHtml(), loadData(), loadUrls(), showToast(), updateStatus()

### Community 53 - "copy-apk.js"
Cohesion: 0.33
Nodes (5): apkDst, __dirname, dist, publicApkDst, publicDir

### Community 54 - "deploy-snapshot.cjs"
Cohesion: 0.33
Nodes (5): BACKUP_FILE, DATA_FILE, { execSync }, fs, path

### Community 55 - "seed-data.js"
Cohesion: 0.33
Nodes (5): DATA, dataPath, dbCjsPath, __dirname, now

### Community 56 - "content-laujim.js"
Cohesion: 0.60
Nodes (4): checkAndStore(), sessionFromPage(), storeData(), storeSession()

### Community 57 - "fix-html.js"
Cohesion: 0.33
Nodes (5): __dirname, distApk, html, htmlFile, scriptMatch

### Community 58 - "migrate-to-aiven.cjs"
Cohesion: 0.40
Nodes (3): path, { Pool }, { readFileSync }

### Community 59 - "sync-seed.js"
Cohesion: 0.40
Nodes (3): BASE, __dirname, root

### Community 60 - "scrapeGasFromRenderedUi"
Cohesion: 0.17
Nodes (13): apartmentNumberFrom(), closeWaterBrowser(), closeWaterResource(), collectRenderedWaterPolicies(), configuredApartmentTargets(), gasContractPaymentUrl(), getAllPortalCredentials(), portalFailureResult() (+5 more)

### Community 62 - "darkMode.js"
Cohesion: 0.80
Nodes (4): applyDarkMode(), initDarkMode(), isDarkMode(), toggleDarkMode()

### Community 66 - "Gestión de Apartamentos — Laujim APP"
Cohesion: 0.12
Nodes (16): Arquitectura del Sistema, Estructura del Proyecto, Flujo de Datos, Force Desktop Layout (APK + Mobile Web), Funcionamiento, Funciones Principales, Gestión de Apartamentos — Laujim APP, Impuesto Predial (+8 more)

### Community 67 - "colombiaDate"
Cohesion: 0.12
Nodes (34): activeContractForApartment(), buildAdminDebtReport(), buildCloudDetailedGlobalServicesReport(), buildCloudGlobalServicesReport(), cloudAdminPaymentReminderTemplateData(), cloudAdminPaymentReminderText(), cloudAdminPhones(), cloudApartmentServices() (+26 more)

### Community 68 - "set-camera-codes.cjs"
Cohesion: 0.40
Nodes (3): configPath, fs, path

### Community 69 - "isCapacitor"
Cohesion: 0.35
Nodes (11): Payments(), BackgroundNotifications, configureBackgroundNotifications(), getBackgroundNotificationStatus(), stopBackgroundNotifications(), isCapacitor(), configurePaymentWatcher(), getPaymentWatcherStatus() (+3 more)

### Community 70 - "notifyPaymentAssociationRequired"
Cohesion: 0.26
Nodes (13): associateAutomaticPaymentEvent(), automaticPaymentCandidates(), ensurePaymentAutomationCollections(), evaluateAutomaticPayment(), formatColombiaDateTime(), makeAutomaticPaymentRecord(), normalisePaymentIdentifier(), notifyPaymentAssociationRequired() (+5 more)

### Community 71 - "Utilities.jsx"
Cohesion: 0.20
Nodes (19): billConvenioDebt(), billInteger(), billMeta(), billMoney(), billMonthDebt(), billPaymentChangeLabel(), billStatusText(), billTotalDebt() (+11 more)

### Community 72 - "IntercomDoorbell.jsx"
Cohesion: 0.29
Nodes (8): IntercomDoorbell(), playDoorChime(), publicRequest(), enhanceAudioStream(), getPeerSignal(), postSignal(), startIntercomCall(), STUN_SERVERS

### Community 75 - "waitForRenderedPortal"
Cohesion: 0.50
Nodes (5): portalUiStatus(), queryRenderedGasContract(), queryRenderedTripleAPolicy(), selectRenderedGasContract(), waitForRenderedPortal()

### Community 80 - "_stream_supervisor"
Cohesion: 0.16
Nodes (16): _expire_stale_pauses(), list_cameras(), _playlist_age_s(), Edad en segundos del contenido HLS más reciente (playlist o segmento con…, Borra segmentos .ts viejos (>max_age_s) y vacíos (0 B): limpia pilas rancias…, Inicia el subproceso FFmpeg para streaming continuo HLS en disco/RAM., Sub-stream liviano para tiles: misma receta -c copy, canal 102., Detiene el sub-stream de una cámara. (+8 more)

### Community 81 - "truecaller-verify-otp.cjs"
Cohesion: 0.40
Nodes (3): fs, path, truecaller

### Community 82 - "caller-id-repository.cjs"
Cohesion: 0.18
Nodes (11): createClaimNextJob(), Database, fs, getCallerCache(), getLatestJob(), markJob(), path, rescheduleJob() (+3 more)

### Community 85 - "scan_plates_cloud"
Cohesion: 0.16
Nodes (13): _alpr_register_auto(), _alpr_today(), _alpr_worker(), capture_snapshot(), get_oldest_recordings(), Fecha más vieja con grabación por cámara (sondeo MicroSD, cache 6h)., Retorna (status, is_new_or_moved). status: 'moving' | 'parked' is_new_or_moved:…, Escanea la imagen con Plate Recognizer Cloud API. Aprovecha el token oficial,… (+5 more)

### Community 89 - "ezviz_stream_server.py"
Cohesion: 0.23
Nodes (8): _fetch_range_to_file(), _oldest_for_cam(), _playback_url(), _probe_range_has_data(), _prune_loop(), _prune_recordings(), ¿Hay grabación en ese momento? Lee 4s del playback; True = hay datos., Elimina exports viejos (.mp4/.log) más allá de 7 días o 3 GB (más viejos…

### Community 99 - "Historial de Cambios"
Cohesion: 0.08
Nodes (24): 2026-07-20 — v2.1.0 — Chat, dark mode, cloud-first, editor embebido, refactor mayor, 2026-07-20 — v2.1.1 — Fix crítico: carga datos cloud-first (setCollectionData mutación in-place, useState faltante, protección arrays vacíos, reset-db), 2026-07-21 — v2.2.0 — Chat presence fix, Dashboard imprevistos, auto-guardado contratos, campos trabajo inquilinos, 2026-07-22 — v2.3.0 — Temas pastel inmersivos, antecedentes policiales, predial, PostgreSQL, QR escáner, 2026-07-23 — v2.4.0 — Chrome Extension: auto-fill Facebook Marketplace con fotos, 2026-07-23 — v2.4.1 — Extension v1.4.1: fix dropdown menu close race condition + backup, 2026-07-23 — v2.4.2 — Extension v1.4.3: fix address field detection, fix laundry dropdown false match, 2026-07-23 — v2.4.3 — Extension v1.4.4: scope address query to form, reorder laundry options, exclude address field from dropdown search (+16 more)

### Community 100 - "Extensión de Chrome — Llenar Laujim"
Cohesion: 0.12
Nodes (16): Arquitectura, Backup de referencia, Configuración actual de dropdowns (v1.4.5), Extensión de Chrome — Llenar Laujim, Flujo de `chooseDropdown` (v1.4.5), Gestión de anuncios, Instalación, La app no carga en el navegador (+8 more)

### Community 101 - "get"
Cohesion: 0.17
Nodes (12): alpr_auto_status(), disambiguate_colombian_plate(), download_recording(), get_alpr_snapshot(), get_detected_plates(), get_export_status(), get_live_playlist(), get_retention() (+4 more)

### Community 102 - "set-local-pass.cjs"
Cohesion: 0.18
Nodes (10): actual, crypto, digest, ex, expected, fs, j, parts (+2 more)

### Community 104 - "2. Modos de ejecución"
Cohesion: 0.18
Nodes (11): 1. Instalar dependencias, 2. Modos de ejecución, 3. Compilar APK Android, 4. Sincronizar Seeds, Build de producción, Desarrollo (red local), Desarrollo (solo este PC), Instalación y Uso (+3 more)

### Community 107 - "Configuración Específica por Archivo"
Cohesion: 0.25
Nodes (8): `capacitor.config.json` — Capacitor 8, Configuración Específica por Archivo, `index.html` — Entry Point, `server.cjs` — Servidor Express, `src/App.jsx` — Router e Inicialización, `src/main.jsx` — Bootstrap React, `src/utils/config.js` — Conexión al Servidor, `vite.config.js` — Build & Dev Server

### Community 108 - "Sistema de Temas (6 Temas Visuales)"
Cohesion: 0.29
Nodes (7): Componentes, Implementación CSS (`src/index.css`), Persistencia y Sincronización, Regla 60-30-10, Sistema de Temas (6 Temas Visuales), Temas disponibles, Utility classes

### Community 109 - "Construir APK para Android"
Cohesion: 0.33
Nodes (5): Alternativa sin Android Studio (solo CLI), Construir APK para Android, Notas, Pasos, Requisitos

### Community 110 - "API REST Completa"
Cohesion: 0.33
Nodes (6): API REST Completa, Editor API (auth Basic: admin/admin123), Endpoints de Antecedentes (Policía), Endpoints de Archivos, Endpoints Generales, Endpoints Genéricos (CRUD Automático)

### Community 111 - "Convertir a APK con Capacitor"
Cohesion: 0.40
Nodes (4): Convertir a APK con Capacitor, Pasos, Requisitos, Requisitos del sistema para compilar APK

### Community 113 - "Base de Datos en Memoria"
Cohesion: 0.40
Nodes (5): 13 Colecciones, API por colección, Base de Datos en Memoria, Funciones de manipulación, Seed Data Embebido

### Community 114 - "Servicios Públicos y QR de Pago"
Cohesion: 0.40
Nodes (5): Almacenamiento, Consulta horaria de agua, Escáner QR, Página Utilities (`/utilities`), Servicios Públicos y QR de Pago

### Community 115 - "Datos Iniciales (Seed)"
Cohesion: 0.50
Nodes (4): Apartamentos (12 unidades), Datos Iniciales (Seed), Inquilinos de Prueba (WhatsApp Bot), Usuarios

### Community 116 - "Consulta de Antecedentes (Policía)"
Cohesion: 0.50
Nodes (4): Auto-Check (API Server-Side), Captcha Proxy Flow (Iframe), Consulta de Antecedentes (Policía), Marcado Manual

### Community 117 - "Sistema de Chat"
Cohesion: 0.50
Nodes (4): Componentes, Estados de Presencia, Rooms, Sistema de Chat

### Community 119 - "Requerimientos del Sistema"
Cohesion: 0.50
Nodes (4): Dependencias npm (21 production, 5 dev), Para compilar APK (Android), Para desarrollo/web local, Requerimientos del Sistema

### Community 120 - "Sistema de Autenticación"
Cohesion: 0.50
Nodes (4): Login Admin, Login Inquilino, Sesión, Sistema de Autenticación

### Community 121 - "_run_export_multi_job"
Cohesion: 0.38
Nodes (7): _pause_for_export(), Descarga N rangos y los UNE en un solo MP4 (concat sin recodificar)., Detiene ordenadamente el subproceso FFmpeg de una cámara., _run_export_job(), _run_export_multi_job(), _stop_single_stream(), _unpause_export()

### Community 122 - "VehicleStationaryTracker"
Cohesion: 0.33
Nodes (3): Rastreador espacial de vehículos. Determina si un vehículo está en movimiento o…, Determina si debemos llamar a la API Cloud o si está estacionado., VehicleStationaryTracker

### Community 126 - "generate-proposal.cjs"
Cohesion: 0.50
Nodes (3): fs, path, targetPath

### Community 152 - "Persistencia PostgreSQL"
Cohesion: 0.50
Nodes (4): Configuración SSL, Esquema, Flujo, Persistencia PostgreSQL

### Community 155 - "ThemeSelector.jsx"
Cohesion: 0.33
Nodes (10): iconMap, ThemeSelector(), applyTheme(), getTheme(), getThemeInfo(), initTheme(), setTheme(), syncThemeToServer() (+2 more)

### Community 156 - "api"
Cohesion: 0.21
Nodes (9): api, ContractGenerator(), getPredialUrl(), lookupRef(), Predial(), REF_MAP, ShareApartments(), buildApartmentsHTML() (+1 more)

### Community 178 - "scrapeAirE"
Cohesion: 0.15
Nodes (14): attachBrowserlessCaptchaSolver(), BROWSERLESS_PROFILES, browserlessEndpointCandidates(), browserlessEndpointFor(), configuredAirETargets(), contractFromAirEResources(), firstExistingPath(), getAirECredentials() (+6 more)

### Community 179 - "calendar.js"
Cohesion: 0.38
Nodes (10): addCalendarReminder(), downloadICS(), fmtDate(), generateAllPaymentReminders(), generateICS(), getStoredUIDs(), nextDueDate(), saveStoredUIDs() (+2 more)

### Community 180 - "handoff.cjs"
Cohesion: 0.20
Nodes (7): { execFileSync }, fs, graphCommit, graphFile, path, porcelain, root

### Community 181 - "authorizedCloudContact"
Cohesion: 0.31
Nodes (10): activeContractForTenant(), apartmentIdFromReference(), authorizedCloudContact(), contractDateMs(), isCurrentContract(), isTenantSessionValid(), repairCloudConversationContext(), resolveCloudConversationContext() (+2 more)

## Knowledge Gaps
- **550 isolated node(s):** `Database`, `path`, `fs`, `{
  createClaimNextJob,
  saveLookupResult,
  markJob,
  rescheduleJob
}`, `https` (+545 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **50 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `init()` connect `config.js` to `services-scraper.cjs`, `startServer`, `startServer`?**
  _High betweenness centrality (0.190) - this node is a cross-community bridge._
- **Why does `installFailoverFetch()` connect `config.js` to `App.jsx`?**
  _High betweenness centrality (0.186) - this node is a cross-community bridge._
- **Why does `startServer()` connect `startServer` to `server.cjs`, `config.js`, `saveData`, `colombiaDate`, `handleCloudInbound`, `notifyPaymentAssociationRequired`, `cloudServiceAmounts`, `createCloudServicesReportMedia`, `worker-protocol.cjs`, `caller-id-repository.cjs`, `payment-receipt-ocr.cjs`, `content-facebook.js`, `authorizedCloudContact`, `runGasScrapeOnce`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `startServer()` (e.g. with `log()` and `publicEdgeView()`) actually correct?**
  _`startServer()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Database`, `path`, `fs` to the rest of the system?**
  _550 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `server.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.0331225534477567 - nodes in this community are weakly interconnected._
- **Should `config.js` be split into smaller, more focused modules?**
  _Cohesion score 0.055206548638873025 - nodes in this community are weakly interconnected._