# Graph Report - Proyecto Laujim APP fix  (2026-10-04)

## Corpus Check
- 231 files · ~268,424 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2053 nodes · 4166 edges · 226 communities (161 shown, 65 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 122 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `36e9bf32`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ApartmentDetail.jsx
- server.cjs
- ScraperWorker.jsx
- auth.js
- startServer
- handleCloudInbound
- colombiaDate
- opencode-bridge.cjs
- handleCloudAdminMessage
- services-scraper.cjs
- scripts
- Settings.jsx
- App.jsx
- dependencies
- fb-publisher.cjs
- api.js
- extension/manifest.json
- react
- scrapeAirE
- WhatsAppInbox.jsx
- better-sqlite3
- cloudServiceAmounts
- ffmpeg-static
- worker-protocol.cjs
- sleep
- Historial de Cambios
- Predial.jsx
- content-facebook.js
- scrapeTripleAFromRenderedUi
- ezviz_stream_server.py
- truecaller-smoke.cjs
- cloudReady
- ThemeSelector.jsx
- get
- portable-worker.cjs
- payment-receipt-ocr.cjs
- hls.js
- jsqr
- Gestión de Apartamentos — Laujim APP
- auth.cjs
- libphonenumber-js
- getAuth
- _stream_supervisor
- node-cron
- Extensión de Chrome — Llenar Laujim
- build-apk.cjs
- contractGenerator.js
- pizzip
- caller-id-repository.cjs
- continuidad.cjs
- graphify-update.cjs
- puppeteer-core
- @sparticuz/chromium
- public/manifest.json
- runGasScrapeOnce
- isCapacitor
- scripts/generate-version.js
- scrapeGasFromRenderedUi
- release-apk.cjs
- PROTOCOLO DE ORQUESTACIÓN: ASTRA / CODEX <-> GRAFOS <-> VM LAUJIM
- post
- 2. Paso a Paso de la Migración
- 2. Modos de ejecución
- handoff.cjs
- set-local-pass.cjs
- test-marketplace-api.cjs
- activeContractForApartment
- getRawBase
- vm-test-form-fill.cjs
- backup.js
- setup-graphify-hooks.cjs
- sync-aiven-before-push.cjs
- test-water-scraper.cjs
- .oxlintrc.json
- sync-all.cjs
- backup-media-s3.cjs
- harness-continuity.cjs
- restore-media-s3.cjs
- trigger_alpr_scan
- Configuración Específica por Archivo
- add-passwords.js
- archive-graph.cjs
- scrape-predial.cjs
- vm-test-step2-publish.cjs
- _run_export_multi_job
- Restauración ante desastre (VM perdida o disco muerto)
- Sistema de Temas (6 Temas Visuales)
- sync-graph-aiven.cjs
- matchPortalApartmentForService
- Construir APK para Android
- VehicleStationaryTracker
- content-portals.js
- popup.js
- API REST Completa
- cdp-drive.py
- scripts/copy-apk.js
- deploy-snapshot.cjs
- scripts/fix-html.js
- note-vm-change.cjs
- seed-data.js
- Convertir a APK con Capacitor
- content-laujim.js
- Base de Datos en Memoria
- Servicios Públicos y QR de Pago
- sftp-sync-vm.py
- check-secrets.cjs
- migrate-to-aiven.cjs
- set-camera-codes.cjs
- sync-seed.js
- truecaller-request-otp.cjs
- truecaller-verify-otp.cjs
- waitForRenderedPortal
- src/utils/darkMode.js
- crop_best_vehicle
- _enrich_job_live
- Datos Iniciales (Seed)
- Consulta de Antecedentes (Policía)
- Sistema de Chat
- Persistencia PostgreSQL
- Requerimientos del Sistema
- Sistema de Autenticación
- capture-proposal.cjs
- generate-proposal.cjs
- src/utils/clipboard.js
- docker-start.sh
- background.js
- send-files-vm.py
- test_ml_pipeline.py
- xvfb-smoke.cjs
- pg-set-admin.cjs
- pg-verify.cjs
- prepare-capacitor-assets.js
- b64u
- set-admin-pass.cjs
- setup-aiven-devices.cjs
- verify-admin.cjs
- install-vm.sh
- sync-db-aiven.sh
- pre-commit
- pre-push
- vm-test-fix-location.cjs
- @capacitor/core
- @capacitor/filesystem
- @capacitor/local-notifications
- @capacitor/share
- vm-test-location-pick.cjs
- lucide-react
- multer
- vm-job-inspect.cjs
- vm-check-all-logs.cjs
- vm-extract-selling-url.cjs
- react
- react-router-dom
- tailwindcss
- @tailwindcss/vite
- vm-test-click-card.cjs
- truecallerjs
- public/sw.js
- pg-del-hash.cjs
- pg-where.cjs
- probe-stdin.cjs
- setup-vm-cron.sh
- vm-fb-vnc.sh
- vm-requeue-job.cjs
- @capacitor/android
- check-ezviz-open.cjs
- vm-aiven-requeue.cjs
- vm-diagnose-rental-fields.cjs
- vm-enable-fb-worker.sh
- vm-probe-chrome.cjs
- dexie
- express
- vm-probe-fbform.cjs
- react-dom
- @capacitor-mlkit/barcode-scanning
- setup-ssh-any-pc.sh script
- diag-video.sh
- deploy_temp.sh
- vm-fix-version-file.sh
- vm-retry-job.sh
- vm-worker-retry.sh
- vm-worker-start.sh

## God Nodes (most connected - your core abstractions)
1. `startServer()` - 101 edges
2. `getBase()` - 50 edges
3. `handleCloudInbound()` - 43 edges
4. `handleCloudAdminMessage()` - 41 edges
5. `saveData()` - 41 edges
6. `react` - 36 edges
7. `getAuth()` - 35 edges
8. `sendCloudText()` - 30 edges
9. `Gestión de Apartamentos — Laujim APP` - 25 edges
10. `Historial de Cambios` - 24 edges

## Surprising Connections (you probably didn't know these)
- `startServer()` --indirect_call--> `log()`  [INFERRED]
  server.cjs → extension/content-facebook.js
- `startServer()` --calls--> `getCallerCache()`  [EXTRACTED]
  server.cjs → lib/caller-id/caller-id-repository.cjs
- `startServer()` --calls--> `getLatestJob()`  [EXTRACTED]
  server.cjs → lib/caller-id/caller-id-repository.cjs
- `generateApartmentPDF()` --references--> `jspdf`  [EXTRACTED]
  src/utils/pdf.js → package.json
- `archiveCloudInboundMedia()` --calls--> `analysePaymentProofMedia()`  [EXTRACTED]
  server.cjs → payment-receipt-ocr.cjs

## Import Cycles
- None detected.

## Communities (226 total, 65 thin omitted)

### Community 0 - "ApartmentDetail.jsx"
Cohesion: 0.05
Nodes (65): Modal(), COLORS, CustomTooltip(), getChartData(), getPaymentStatus(), PaymentHistoryChart(), StatsCard(), ApartmentDetail() (+57 more)

### Community 1 - "server.cjs"
Cohesion: 0.03
Nodes (75): INITIAL_DATA, accessRateLimits, adminAgentModes, adminPasswordMatches(), { analysePaymentProofMedia, ocrSummary }, app, automaticPaymentPeriod(), automaticPaymentTenantName() (+67 more)

### Community 2 - "ScraperWorker.jsx"
Cohesion: 0.08
Nodes (64): init(), readInstalledAndroidVersion(), triggerNativeUpdateNotification(), VersionBanner(), versionIsNewer(), DEFAULT_SCHEDULE, formatLogTime(), formatSchedule() (+56 more)

### Community 3 - "auth.js"
Cohesion: 0.11
Nodes (36): refreshAllFromServer(), startCloudPolling(), startDataVersionPolling(), stopCloudPolling(), stopDataVersionPolling(), ERROR_TEXT, GitHubAuth(), APTO_CAMERAS (+28 more)

### Community 4 - "startServer"
Cohesion: 0.07
Nodes (43): accessRateAllowed(), apartmentIdFromReference(), appendAccessEvent(), authorizedCloudContact(), automaticPaymentIsRentOnly(), cameraDefinitions(), cloudMediaKind(), constantTimeEqual() (+35 more)

### Community 5 - "handleCloudInbound"
Cohesion: 0.10
Nodes (39): acknowledgePaymentProof(), addCloudMessage(), blockCloudUser(), clearCloudAuthState(), cloudAdminPaymentReminderTemplateName(), cloudInboundMedia(), cloudInteractiveAction(), cloudInteractiveIsPaymentConfirmed() (+31 more)

### Community 6 - "colombiaDate"
Cohesion: 0.14
Nodes (24): buildCloudDetailedGlobalServicesReport(), buildCloudFinancingImageData(), buildCloudGlobalServicesReport(), buildCloudServicesImageData(), cloudAdminPaymentReminderText(), cloudApartmentServices(), cloudFormatFullDate(), cloudPaymentResultLine() (+16 more)

### Community 7 - "opencode-bridge.cjs"
Cohesion: 0.08
Nodes (33): AGENT_CATALOG, AGENT_MIME, agentConfig(), agentOutboxFiles(), cleanAgentOutput(), CONTEXT_FILES, fs, getAgentModel() (+25 more)

### Community 8 - "handleCloudAdminMessage"
Cohesion: 0.10
Nodes (57): activeTenantForApartment(), clearAdminAgentMode(), cloudAdminGreeting(), cloudApartmentFloor(), cloudApartmentsForFloor(), cloudApiRequest(), cloudFindApartment(), cloudListSections() (+49 more)

### Community 9 - "services-scraper.cjs"
Cohesion: 0.07
Nodes (31): AIR_E_NIC_MAP, AIR_E_URLS, BROWSERLESS_REGION, BROWSERLESS_SOLVE_CAPTCHAS, BROWSERLESS_STEALTH, BROWSERLESS_TIMEOUT_MS, BROWSERLESS_TOKENS, BROWSERLESS_WS_ENDPOINT (+23 more)

### Community 10 - "scripts"
Cohesion: 0.05
Nodes (37): oxlint, devDependencies, oxlint, playwright, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+29 more)

### Community 11 - "Settings.jsx"
Cohesion: 0.18
Nodes (27): PrivateApp(), Settings(), analyzeIncomingNumber(), BANK_WHITELIST, CALL_GUARD_STORAGE_KEY, callerScreeningPlugin(), DEFAULT_CALL_GUARD_CONFIG, DELIVERY_WHITELIST (+19 more)

### Community 12 - "App.jsx"
Cohesion: 0.10
Nodes (28): api, AdminRoute(), ProtectedRoute(), Layout(), navItems, Apartments(), ContractGenerator(), Login() (+20 more)

### Community 13 - "dependencies"
Cohesion: 0.11
Nodes (19): @aws-sdk/client-s3, @capacitor/cli, cors, docxtemplater, dependencies, @aws-sdk/client-s3, @capacitor/cli, cors (+11 more)

### Community 14 - "fb-publisher.cjs"
Cohesion: 0.13
Nodes (32): api(), ARGS, chromeBin(), clickTextButton(), DEVICE, discover(), downloadAll(), fieldContext() (+24 more)

### Community 15 - "api.js"
Cohesion: 0.11
Nodes (23): CLOUD_COLLECTIONS, createItem(), currentAuthToken(), deleteItem(), getCloudSyncStatus(), getDataVersion(), getServerVersion(), lastCloudSyncStatus (+15 more)

### Community 16 - "extension/manifest.json"
Cohesion: 0.07
Nodes (29): action, default_icon, default_popup, default_title, background, service_worker, content_scripts, 128 (+21 more)

### Community 17 - "react"
Cohesion: 0.18
Nodes (7): react, App(), ErrorBoundary, Admin(), dayKey(), fmtBytes(), fmtDate()

### Community 18 - "scrapeAirE"
Cohesion: 0.15
Nodes (14): attachBrowserlessCaptchaSolver(), BROWSERLESS_PROFILES, browserlessEndpointCandidates(), browserlessEndpointFor(), configuredAirETargets(), contractFromAirEResources(), firstExistingPath(), getAirECredentials() (+6 more)

### Community 19 - "WhatsAppInbox.jsx"
Cohesion: 0.27
Nodes (7): apartmentBadge(), attachmentKind(), cloudRequest(), formatTimeOnly(), getActiveToken(), MediaMessage(), WhatsAppInbox()

### Community 21 - "cloudServiceAmounts"
Cohesion: 0.15
Nodes (32): buildDebtReply(), clearUtilityFinancing(), cloudAdminPaymentReminderTemplateData(), cloudServiceAmounts(), cloudServiceDisplayBlock(), cloudServiceReference(), cloudServiceState(), cloudUtilityMoney() (+24 more)

### Community 23 - "worker-protocol.cjs"
Cohesion: 0.18
Nodes (23): assert, records, worker, ALLOWED_STATUSES, crypto, gasContractPaymentUrl(), inspectWorkerResults(), isoOrNow() (+15 more)

### Community 24 - "sleep"
Cohesion: 0.16
Nodes (26): clickVisibleButton(), clickVisiblePortalButtonByText(), executePortalTurnstile(), getPortalCredentials(), gotoPortalPage(), inspectWaterPage(), loginGasWithPortalApi(), loginPortalPage() (+18 more)

### Community 25 - "Historial de Cambios"
Cohesion: 0.08
Nodes (24): 2026-07-20 — v2.1.0 — Chat, dark mode, cloud-first, editor embebido, refactor mayor, 2026-07-20 — v2.1.1 — Fix crítico: carga datos cloud-first (setCollectionData mutación in-place, useState faltante, protección arrays vacíos, reset-db), 2026-07-21 — v2.2.0 — Chat presence fix, Dashboard imprevistos, auto-guardado contratos, campos trabajo inquilinos, 2026-07-22 — v2.3.0 — Temas pastel inmersivos, antecedentes policiales, predial, PostgreSQL, QR escáner, 2026-07-23 — v2.4.0 — Chrome Extension: auto-fill Facebook Marketplace con fotos, 2026-07-23 — v2.4.1 — Extension v1.4.1: fix dropdown menu close race condition + backup, 2026-07-23 — v2.4.2 — Extension v1.4.3: fix address field detection, fix laundry dropdown false match, 2026-07-23 — v2.4.3 — Extension v1.4.4: scope address query to form, reorder laundry options, exclude address field from dropdown search (+16 more)

### Community 26 - "Predial.jsx"
Cohesion: 0.33
Nodes (8): authHeaders(), DATO_LABELS, fmtDate(), fmtMoney(), getPredialUrl(), lookupRef(), Predial(), REF_MAP

### Community 27 - "content-facebook.js"
Cohesion: 0.25
Nodes (22): activate(), autoFill(), checkAndRun(), chooseDropdown(), fillAndConfirmAddress(), fillAndConfirmAddressReliable(), findAndSet(), findDropdown() (+14 more)

### Community 28 - "scrapeTripleAFromRenderedUi"
Cohesion: 0.18
Nodes (23): aggregateAirEInvoices(), fetchGasDebtSummary(), fetchPortalJson(), fetchTripleAPortalSummary(), gasDebtSummary(), gasInvoiceSummary(), normalizePortalText(), parsePortalAmount() (+15 more)

### Community 29 - "ezviz_stream_server.py"
Cohesion: 0.12
Nodes (15): datetime, alpr_auto_status(), _fetch_range_to_file(), get_live_playlist(), get_retention(), _oldest_for_cam(), _playback_url(), _probe_range_has_data() (+7 more)

### Community 30 - "truecaller-smoke.cjs"
Cohesion: 0.14
Nodes (12): normalizePhone(), CallerIdProviderError, firstFiniteNumber(), https, normalizeNullableText(), parseTruecallerHtml(), TruecallerProvider, fs (+4 more)

### Community 31 - "cloudReady"
Cohesion: 0.14
Nodes (27): archiveCloudInboundMedia(), cloudConfig(), cloudFinancingReportHtml(), cloudGraphRequest(), cloudImageMoney(), cloudReady(), cloudServicesReportHtml(), createCloudFinancingReportMedia() (+19 more)

### Community 32 - "ThemeSelector.jsx"
Cohesion: 0.32
Nodes (11): iconMap, ThemeSelector(), applyTheme(), getTheme(), getThemeInfo(), initTheme(), loadThemeFromServer(), setTheme() (+3 more)

### Community 33 - "get"
Cohesion: 0.15
Nodes (20): _alpr_bump_usage(), _alpr_register_auto(), _alpr_today(), _alpr_usage(), _alpr_usage_file(), _alpr_worker(), disambiguate_colombian_plate(), download_recording() (+12 more)

### Community 34 - "portable-worker.cjs"
Cohesion: 0.16
Nodes (17): applyRemoteConfig(), chromeProfileDir, config, configPath, fs, loadRemoteConfig(), localDb, main() (+9 more)

### Community 35 - "payment-receipt-ocr.cjs"
Cohesion: 0.17
Nodes (25): pdf-parse, amountCandidates(), analysePaymentProofMedia(), analyseText(), detectProvider(), extractDate(), extractPdfScreenshots(), extractPdfText() (+17 more)

### Community 38 - "Gestión de Apartamentos — Laujim APP"
Cohesion: 0.12
Nodes (16): Arquitectura del Sistema, Estructura del Proyecto, Flujo de Datos, Force Desktop Layout (APK + Mobile Web), Funcionamiento, Funciones Principales, Gestión de Apartamentos — Laujim APP, Impuesto Predial (+8 more)

### Community 39 - "auth.cjs"
Cohesion: 0.18
Nodes (16): clearLocalCredentials(), crypto, fs, generateToken(), getLocalCredentials(), getPool(), hashToken(), LOCAL_CRED_DIR (+8 more)

### Community 41 - "getAuth"
Cohesion: 0.30
Nodes (17): Chat(), getAuth(), requireAuth(), fetchPresence(), getAllRooms(), getRoomMessages(), getStatusLabel(), lastCheck (+9 more)

### Community 42 - "_stream_supervisor"
Cohesion: 0.16
Nodes (16): _expire_stale_pauses(), list_cameras(), _playlist_age_s(), Edad en segundos del contenido HLS más reciente (playlist o segmento con…, Borra segmentos .ts viejos (>max_age_s) y vacíos (0 B): limpia pilas rancias…, Inicia el subproceso FFmpeg para streaming continuo HLS en disco/RAM., Sub-stream liviano para tiles: misma receta -c copy, canal 102., Detiene el sub-stream de una cámara. (+8 more)

### Community 44 - "Extensión de Chrome — Llenar Laujim"
Cohesion: 0.12
Nodes (16): Arquitectura, Backup de referencia, Configuración actual de dropdowns (v1.4.5), Extensión de Chrome — Llenar Laujim, Flujo de `chooseDropdown` (v1.4.5), Gestión de anuncios, Instalación, La app no carga en el navegador (+8 more)

### Community 45 - "build-apk.cjs"
Cohesion: 0.14
Nodes (14): addCandidate(), androidCandidates, androidHome, apkPath, env, { execFileSync, spawnSync }, findJdk21(), fs (+6 more)

### Community 46 - "contractGenerator.js"
Cohesion: 0.14
Nodes (15): jspdf, jspdf, centenasALetras(), CIENTOS, CLAUSULAS, DECENAS, ESPECIALES, fechaEnLetras() (+7 more)

### Community 48 - "caller-id-repository.cjs"
Cohesion: 0.26
Nodes (13): createClaimNextJob(), Database, enqueueLookup(), fs, getCallerCache(), getLatestJob(), initDatabase(), markJob() (+5 more)

### Community 49 - "continuidad.cjs"
Cohesion: 0.13
Nodes (12): autoBlock, bitacoraFile, { execFileSync }, fs, modified, path, pendientesFile, porcelain (+4 more)

### Community 50 - "graphify-update.cjs"
Cohesion: 0.14
Nodes (12): args, { existsSync, readFileSync }, findPython(), hasGraphify(), { homedir }, { join, dirname }, PROJECT_ROOT, python (+4 more)

### Community 53 - "public/manifest.json"
Cohesion: 0.14
Nodes (13): background_color, categories, description, display, icons, name, orientation, screenshots (+5 more)

### Community 55 - "runGasScrapeOnce"
Cohesion: 0.22
Nodes (14): completePortalResults(), enqueueServiceBrowserRun(), isTransientPortalRunError(), notifyPersistedUtilityChanges(), persistGasResults(), persistResults(), persistUtilityResults(), persistWaterResults() (+6 more)

### Community 56 - "isCapacitor"
Cohesion: 0.35
Nodes (11): Payments(), BackgroundNotifications, configureBackgroundNotifications(), getBackgroundNotificationStatus(), stopBackgroundNotifications(), isCapacitor(), configurePaymentWatcher(), getPaymentWatcherStatus() (+3 more)

### Community 58 - "scripts/generate-version.js"
Cohesion: 0.15
Nodes (11): androidGradle, apkVersion, appVersion, __dirname, dist, now, publicDir, publicVersionFile (+3 more)

### Community 59 - "scrapeGasFromRenderedUi"
Cohesion: 0.17
Nodes (13): apartmentNumberFrom(), closeWaterBrowser(), closeWaterResource(), collectRenderedWaterPolicies(), configuredApartmentTargets(), gasContractPaymentUrl(), getAllPortalCredentials(), portalFailureResult() (+5 more)

### Community 60 - "release-apk.cjs"
Cohesion: 0.23
Nodes (11): bumpVersion(), fs, gradleFile, main(), path, readVersion(), root, run() (+3 more)

### Community 61 - "PROTOCOLO DE ORQUESTACIÓN: ASTRA / CODEX <-> GRAFOS <-> VM LAUJIM"
Cohesion: 0.22
Nodes (8): 1. Comando de Inicialización para Astra / Codex, 2. Flujo de Sincronización 1:1 Automática, 3. Acceso SSH desde cualquier computador, Comando de sincronización unificado:, En Linux / Mac:, En Windows (PowerShell):, PROTOCOLO DE ORQUESTACIÓN: ASTRA / CODEX <-> GRAFOS <-> VM LAUJIM, Qué hace este comando:

### Community 62 - "post"
Cohesion: 0.22
Nodes (11): BaseModel, export_recording(), export_recording_multi(), ExportMultiRequest, ExportRequest, parse_to_rtsp_ts(), ping_stream(), Retorna instantáneamente (<0.1s) la playlist HLS activa. (+3 more)

### Community 63 - "2. Paso a Paso de la Migración"
Cohesion: 0.18
Nodes (10): 1. Datos de tu Servidor Oracle VM, 2. Paso a Paso de la Migración, 3. Resumen de Ventajas Obtenidas, GUÍA COMPLETA: ORACLE VM ALWAYS FREE (149.130.160.116), PASO 1: Conectarse a la VM, PASO 2: Sincronizar los archivos del proyecto a la VM, PASO 3: Ejecutar el Instalador Automático, PASO 4: Configuración en Cloudflare (Dominio y SSL) (+2 more)

### Community 68 - "2. Modos de ejecución"
Cohesion: 0.18
Nodes (11): 1. Instalar dependencias, 2. Modos de ejecución, 3. Compilar APK Android, 4. Sincronizar Seeds, Build de producción, Desarrollo (red local), Desarrollo (solo este PC), Instalación y Uso (+3 more)

### Community 69 - "handoff.cjs"
Cohesion: 0.18
Nodes (8): { execFileSync }, fs, graphCommit, graphFile, headShort, path, porcelain, root

### Community 70 - "set-local-pass.cjs"
Cohesion: 0.18
Nodes (10): actual, crypto, digest, ex, expected, fs, j, parts (+2 more)

### Community 71 - "test-marketplace-api.cjs"
Cohesion: 0.22
Nodes (10): child, fs, os, path, project, request(), run(), { spawn } (+2 more)

### Community 72 - "activeContractForApartment"
Cohesion: 0.13
Nodes (27): activeContractForApartment(), activeContractForTenant(), associateAutomaticPaymentEvent(), automaticPaymentCandidates(), buildAdminDebtReport(), cloudAdminPhones(), cloudCalendarDate(), cloudCapitalise() (+19 more)

### Community 73 - "getRawBase"
Cohesion: 0.12
Nodes (22): CameraIntercom(), BUILDING_CAMERAS, IntercomCallModal(), intercomRequest(), BUILDING_CAMERAS, colombiaTime(), IntercomCallPage(), publicRequest() (+14 more)

### Community 74 - "vm-test-form-fill.cjs"
Cohesion: 0.27
Nodes (11): fieldContext(), fillOne(), findField(), fs, norm(), os, path, pickOption() (+3 more)

### Community 75 - "backup.js"
Cohesion: 0.20
Nodes (9): backupDir, dataDir, __dirname, dst, files, now, root, src (+1 more)

### Community 76 - "setup-graphify-hooks.cjs"
Cohesion: 0.20
Nodes (9): DST, { existsSync, copyFileSync, mkdirSync, chmodSync }, GIT_DIR, HOOKS_DIR, { join, dirname }, PRE_PUSH_DST, PRE_PUSH_SRC, ROOT (+1 more)

### Community 77 - "sync-aiven-before-push.cjs"
Cohesion: 0.24
Nodes (9): collectionCount(), DATA_FILE, { execFileSync }, fs, localDataChanged(), path, { Pool }, ROOT (+1 more)

### Community 78 - "test-water-scraper.cjs"
Cohesion: 0.20
Nodes (9): airSummary, assert, db, financing, gasSummary, gasWithAgreement, scraper, splitTripleSummary (+1 more)

### Community 79 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 80 - "sync-all.cjs"
Cohesion: 0.33
Nodes (6): { execSync }, fs, main(), path, root, run()

### Community 82 - "backup-media-s3.cjs"
Cohesion: 0.28
Nodes (8): fs, main(), path, r2Config(), root, { S3Client, ListObjectsV2Command, PutObjectCommand }, SOURCES, walk()

### Community 83 - "harness-continuity.cjs"
Cohesion: 0.28
Nodes (8): arg(), bitacoraFile, { execFileSync, spawnSync }, fs, git(), main(), path, root

### Community 84 - "restore-media-s3.cjs"
Cohesion: 0.28
Nodes (8): fs, main(), path, r2Config(), root, { S3Client, ListObjectsV2Command, GetObjectCommand }, streamToBuffer(), TARGETS

### Community 86 - "trigger_alpr_scan"
Cohesion: 0.29
Nodes (8): capture_best_frame(), capture_snapshot(), _frame_sharpness(), Escaneo manual con Plate Recognizer Cloud: mode = 'compare' (nube; comparativa…, Extrae un fotograma JPEG nítido instantáneamente desde el último segmento TS en…, Nitidez por varianza del Laplaciano (mayor = más nítido)., Ráfaga para placas en movimiento (motos): extrae N frames del segmento más…, trigger_alpr_scan()

### Community 89 - "Configuración Específica por Archivo"
Cohesion: 0.25
Nodes (8): `capacitor.config.json` — Capacitor 8, Configuración Específica por Archivo, `index.html` — Entry Point, `server.cjs` — Servidor Express, `src/App.jsx` — Router e Inicialización, `src/main.jsx` — Bootstrap React, `src/utils/config.js` — Conexión al Servidor, `vite.config.js` — Build & Dev Server

### Community 90 - "add-passwords.js"
Cohesion: 0.25
Nodes (6): db, dbCjsPath, dbPath, __dirname, root, seedCopy

### Community 91 - "archive-graph.cjs"
Cohesion: 0.25
Nodes (6): archiveDir, fs, graphFile, path, root, zlib

### Community 92 - "scrape-predial.cjs"
Cohesion: 0.43
Nodes (7): cleanText(), fieldAfter(), LABELS, main(), parseMoney(), parseVigencias(), scrapePredial()

### Community 93 - "vm-test-step2-publish.cjs"
Cohesion: 0.32
Nodes (6): fs, norm(), path, pickOption(), puppeteer, sleep()

### Community 94 - "_run_export_multi_job"
Cohesion: 0.38
Nodes (7): _pause_for_export(), Descarga N rangos y los UNE en un solo MP4 (concat sin recodificar)., Detiene ordenadamente el subproceso FFmpeg de una cámara., _run_export_job(), _run_export_multi_job(), _stop_single_stream(), _unpause_export()

### Community 95 - "Restauración ante desastre (VM perdida o disco muerto)"
Cohesion: 0.29
Nodes (6): Acceso multi-PC (Tailscale, indefinido), Dónde trabaja la IA en la VM (dos carpetas, no mezclar), Notas, Reconstrucción (VM Ubuntu nueva), Requisitos previos (guardados FUERA de la VM, gestor de claves), Restauración ante desastre (VM perdida o disco muerto)

### Community 97 - "Sistema de Temas (6 Temas Visuales)"
Cohesion: 0.29
Nodes (7): Componentes, Implementación CSS (`src/index.css`), Persistencia y Sincronización, Regla 60-30-10, Sistema de Temas (6 Temas Visuales), Temas disponibles, Utility classes

### Community 98 - "sync-graph-aiven.cjs"
Cohesion: 0.33
Nodes (6): dbUrl(), fs, main(), path, root, strict

### Community 99 - "matchPortalApartmentForService"
Cohesion: 0.33
Nodes (7): logUnmatchedPortalItems(), matchPortalApartment(), matchPortalApartmentForService(), normalizeDigits(), portalCodeValues(), portalDiagnosticReferences(), portalIdentifierValues()

### Community 100 - "Construir APK para Android"
Cohesion: 0.33
Nodes (5): Alternativa sin Android Studio (solo CLI), Construir APK para Android, Notas, Pasos, Requisitos

### Community 101 - "VehicleStationaryTracker"
Cohesion: 0.33
Nodes (3): Rastreador espacial de vehículos. Determina si un vehículo está en movimiento o…, Determina si debemos llamar a la API Cloud o si está estacionado., VehicleStationaryTracker

### Community 102 - "content-portals.js"
Cohesion: 0.53
Nodes (4): attempt(), fillAndSubmit(), reportError(), showNotice()

### Community 103 - "popup.js"
Cohesion: 0.53
Nodes (5): escapeHtml(), loadData(), loadUrls(), showToast(), updateStatus()

### Community 105 - "API REST Completa"
Cohesion: 0.33
Nodes (6): API REST Completa, Editor API (auth Basic: admin/admin123), Endpoints de Antecedentes (Policía), Endpoints de Archivos, Endpoints Generales, Endpoints Genéricos (CRUD Automático)

### Community 106 - "cdp-drive.py"
Cohesion: 0.67
Nodes (5): evaluate(), find_tab(), http(), main(), tabs()

### Community 107 - "scripts/copy-apk.js"
Cohesion: 0.33
Nodes (5): apkDst, __dirname, dist, publicApkDst, publicDir

### Community 108 - "deploy-snapshot.cjs"
Cohesion: 0.33
Nodes (5): BACKUP_FILE, DATA_FILE, { execSync }, fs, path

### Community 109 - "scripts/fix-html.js"
Cohesion: 0.33
Nodes (5): __dirname, distApk, html, htmlFile, scriptMatch

### Community 110 - "note-vm-change.cjs"
Cohesion: 0.47
Nodes (5): { execFileSync }, fs, git(), main(), readToken()

### Community 111 - "seed-data.js"
Cohesion: 0.33
Nodes (5): DATA, dataPath, dbCjsPath, __dirname, now

### Community 112 - "Convertir a APK con Capacitor"
Cohesion: 0.40
Nodes (4): Convertir a APK con Capacitor, Pasos, Requisitos, Requisitos del sistema para compilar APK

### Community 113 - "content-laujim.js"
Cohesion: 0.60
Nodes (4): checkAndStore(), sessionFromPage(), storeData(), storeSession()

### Community 116 - "Base de Datos en Memoria"
Cohesion: 0.40
Nodes (5): 13 Colecciones, API por colección, Base de Datos en Memoria, Funciones de manipulación, Seed Data Embebido

### Community 117 - "Servicios Públicos y QR de Pago"
Cohesion: 0.40
Nodes (5): Almacenamiento, Consulta horaria de agua, Escáner QR, Página Utilities (`/utilities`), Servicios Públicos y QR de Pago

### Community 118 - "sftp-sync-vm.py"
Cohesion: 0.80
Nodes (4): ensure(), main(), put_dir(), put_file()

### Community 119 - "check-secrets.cjs"
Cohesion: 0.40
Nodes (3): missingRequired, OPTIONAL, REQUIRED

### Community 120 - "migrate-to-aiven.cjs"
Cohesion: 0.40
Nodes (3): path, { Pool }, { readFileSync }

### Community 121 - "set-camera-codes.cjs"
Cohesion: 0.40
Nodes (3): configPath, fs, path

### Community 122 - "sync-seed.js"
Cohesion: 0.40
Nodes (3): BASE, __dirname, root

### Community 123 - "truecaller-request-otp.cjs"
Cohesion: 0.40
Nodes (3): fs, path, truecaller

### Community 124 - "truecaller-verify-otp.cjs"
Cohesion: 0.40
Nodes (3): fs, path, truecaller

### Community 125 - "waitForRenderedPortal"
Cohesion: 0.50
Nodes (5): portalUiStatus(), queryRenderedGasContract(), queryRenderedTripleAPolicy(), selectRenderedGasContract(), waitForRenderedPortal()

### Community 126 - "src/utils/darkMode.js"
Cohesion: 0.80
Nodes (4): applyDarkMode(), initDarkMode(), isDarkMode(), toggleDarkMode()

### Community 127 - "crop_best_vehicle"
Cohesion: 0.50
Nodes (4): crop_best_vehicle(), YOLOv8n lazy (None si no instalado: se usa el frame completo)., Recorta el vehículo/moto más grande (margen 10%). Retorna (crop_path, (ox, oy,…, _yolo_model()

### Community 128 - "_enrich_job_live"
Cohesion: 0.50
Nodes (4): _enrich_job_live(), Lee out_time_ms del archivo -progress de ffmpeg. Retorna segundos o -1 si no…, Agrega tamaño en vivo y % recalculado al vuelo para jobs downloading., _read_ffmpeg_progress()

### Community 130 - "Datos Iniciales (Seed)"
Cohesion: 0.50
Nodes (4): Apartamentos (12 unidades), Datos Iniciales (Seed), Inquilinos de Prueba (WhatsApp Bot), Usuarios

### Community 131 - "Consulta de Antecedentes (Policía)"
Cohesion: 0.50
Nodes (4): Auto-Check (API Server-Side), Captcha Proxy Flow (Iframe), Consulta de Antecedentes (Policía), Marcado Manual

### Community 132 - "Sistema de Chat"
Cohesion: 0.50
Nodes (4): Componentes, Estados de Presencia, Rooms, Sistema de Chat

### Community 133 - "Persistencia PostgreSQL"
Cohesion: 0.50
Nodes (4): Configuración SSL, Esquema, Flujo, Persistencia PostgreSQL

### Community 134 - "Requerimientos del Sistema"
Cohesion: 0.50
Nodes (4): Dependencias npm (21 production, 5 dev), Para compilar APK (Android), Para desarrollo/web local, Requerimientos del Sistema

### Community 135 - "Sistema de Autenticación"
Cohesion: 0.50
Nodes (4): Login Admin, Login Inquilino, Sesión, Sistema de Autenticación

### Community 137 - "generate-proposal.cjs"
Cohesion: 0.50
Nodes (3): fs, path, targetPath

### Community 157 - "vm-test-fix-location.cjs"
Cohesion: 0.32
Nodes (6): fs, norm(), path, pickOption(), puppeteer, sleep()

### Community 164 - "vm-test-location-pick.cjs"
Cohesion: 0.32
Nodes (6): fs, norm(), path, pickOption(), puppeteer, sleep()

### Community 167 - "vm-job-inspect.cjs"
Cohesion: 0.40
Nodes (4): db, fs, logs, want

### Community 168 - "vm-check-all-logs.cjs"
Cohesion: 0.50
Nodes (3): db, fs, logs

## Knowledge Gaps
- **637 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `diag-video.sh script` (+632 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **65 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `init()` connect `ScraperWorker.jsx` to `services-scraper.cjs`, `startServer`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `installFailoverFetch()` connect `ScraperWorker.jsx` to `App.jsx`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `startServer()` connect `startServer` to `server.cjs`, `ScraperWorker.jsx`, `payment-receipt-ocr.cjs`, `handleCloudInbound`, `colombiaDate`, `activeContractForApartment`, `handleCloudAdminMessage`, `caller-id-repository.cjs`, `worker-protocol.cjs`, `cloudServiceAmounts`, `runGasScrapeOnce`, `content-facebook.js`, `cloudReady`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `startServer()` (e.g. with `log()` and `publicEdgeView()`) actually correct?**
  _`startServer()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _637 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ApartmentDetail.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05468164794007491 - nodes in this community are weakly interconnected._
- **Should `server.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.03363303363303363 - nodes in this community are weakly interconnected._