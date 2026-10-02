# Graph Report - Proyecto Laujim APP fix  (2026-10-01)

## Corpus Check
- 203 files · ~250,544 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1930 nodes · 4005 edges · 200 communities (141 shown, 59 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 113 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5476d466`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.cjs
- fb-publisher.cjs
- ScraperWorker.jsx
- saveData
- services-scraper.cjs
- truecaller-smoke.cjs
- notifyPaymentAssociationRequired
- MiApto.jsx
- startServer
- scripts
- continuidad.cjs
- cloudServiceAmounts
- handleCloudInbound
- extension/manifest.json
- api.js
- getAuth
- worker-protocol.cjs
- post
- truecaller-request-otp.cjs
- payment-receipt-ocr.cjs
- sleep
- content-facebook.js
- Utilities.jsx
- restore-media-s3.cjs
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
- sftp-sync-vm.py
- test-marketplace-api.cjs
- check-secrets.cjs
- ThemeSelector.jsx
- backup.js
- setup-graphify-hooks.cjs
- sync-aiven-before-push.cjs
- test-water-scraper.cjs
- .oxlintrc.json
- add-passwords.js
- archive-graph.cjs
- vm-job-inspect.cjs
- sync-graph-aiven.cjs
- 2. Paso a Paso de la Migración
- matchPortalApartmentForService
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
- ffmpeg-static
- waitForRenderedPortal
- note-vm-change.cjs
- config.js
- deploy_temp.sh
- install-vm.sh
- send-files-vm.py
- pre-commit
- pre-push
- sync-db-aiven.sh
- express
- _stream_supervisor
- truecaller-verify-otp.cjs
- caller-id-repository.cjs
- trigger_alpr_scan
- react-dom
- get
- puppeteer-core
- docker-start.sh
- dexie
- ezviz_stream_server.py
- sw.js
- Historial de Cambios
- Extensión de Chrome — Llenar Laujim
- VehicleStationaryTracker
- set-local-pass.cjs
- crop_best_vehicle
- 2. Modos de ejecución
- ApartmentDetail.jsx
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
- react-router-dom
- Requerimientos del Sistema
- Sistema de Autenticación
- _run_export_multi_job
- scrape-predial.cjs
- sendCloudGlobalServices
- capture-proposal.cjs
- multer
- generate-proposal.cjs
- ErrorBoundary
- harness-continuity.cjs
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
- @capacitor/android
- @capacitor/core
- Settings.jsx
- @capacitor/filesystem
- _enrich_job_live
- set-admin-pass.cjs
- verify-admin.cjs
- Restauración ante desastre (VM perdida o disco muerto)
- setup-vm-cron.sh
- App.jsx
- IntercomDoorbell.jsx
- pg-del-hash.cjs
- pg-where.cjs
- probe-stdin.cjs
- @capacitor/local-notifications
- @capacitor-mlkit/barcode-scanning
- @capacitor/share
- vm-aiven-requeue.cjs
- hls.js
- cdp-drive.py
- handoff.cjs
- opencode-bridge.cjs
- libphonenumber-js
- node-cron
- pizzip
- vm-enable-fb-worker.sh
- tailwindcss
- jsqr
- vm-probe-chrome.cjs
- lucide-react
- vm-probe-fbform.cjs
- docxtemplater
- vm-fb-vnc.sh
- vm-fix-version-file.sh
- vm-retry-job.sh
- vm-worker-retry.sh
- vm-worker-start.sh

## God Nodes (most connected - your core abstractions)
1. `startServer()` - 95 edges
2. `getBase()` - 50 edges
3. `handleCloudInbound()` - 43 edges
4. `saveData()` - 42 edges
5. `handleCloudAdminMessage()` - 41 edges
6. `react` - 34 edges
7. `getAuth()` - 31 edges
8. `sendCloudText()` - 27 edges
9. `Gestión de Apartamentos — Laujim APP` - 25 edges
10. `Historial de Cambios` - 24 edges

## Surprising Connections (you probably didn't know these)
- `handleCloudInbound()` --calls--> `ocrSummary()`  [EXTRACTED]
  server.cjs → payment-receipt-ocr.cjs
- `startServer()` --indirect_call--> `log()`  [INFERRED]
  server.cjs → extension/content-facebook.js
- `installFailoverFetch()` --indirect_call--> `init()`  [INFERRED]
  src/utils/failoverFetch.js → services-scraper.cjs
- `archiveCloudInboundMedia()` --calls--> `analysePaymentProofMedia()`  [EXTRACTED]
  server.cjs → payment-receipt-ocr.cjs
- `startServer()` --calls--> `getCallerCache()`  [EXTRACTED]
  server.cjs → lib/caller-id/caller-id-repository.cjs

## Import Cycles
- None detected.

## Communities (200 total, 59 thin omitted)

### Community 0 - "server.cjs"
Cohesion: 0.03
Nodes (78): INITIAL_DATA, accessRateLimits, adminAgentModes, adminPasswordMatches(), { analysePaymentProofMedia, ocrSummary }, app, automaticPaymentPeriod(), automaticPaymentTenantName() (+70 more)

### Community 1 - "fb-publisher.cjs"
Cohesion: 0.13
Nodes (31): api(), ARGS, chromeBin(), clickTextButton(), DEVICE, discover(), downloadAll(), fieldContext() (+23 more)

### Community 2 - "ScraperWorker.jsx"
Cohesion: 0.08
Nodes (64): init(), readInstalledAndroidVersion(), triggerNativeUpdateNotification(), VersionBanner(), versionIsNewer(), DEFAULT_SCHEDULE, formatLogTime(), formatSchedule() (+56 more)

### Community 3 - "saveData"
Cohesion: 0.15
Nodes (43): activeTenantForApartment(), clearCloudAuthState(), cloudApartmentFloor(), cloudApartmentsForFloor(), cloudFindApartment(), cloudListSections(), cloudReminderResultLine(), cloudServiceApartmentsForFloor() (+35 more)

### Community 4 - "services-scraper.cjs"
Cohesion: 0.05
Nodes (45): AIR_E_NIC_MAP, AIR_E_URLS, attachBrowserlessCaptchaSolver(), BROWSERLESS_PROFILES, BROWSERLESS_REGION, BROWSERLESS_SOLVE_CAPTCHAS, BROWSERLESS_STEALTH, BROWSERLESS_TIMEOUT_MS (+37 more)

### Community 5 - "truecaller-smoke.cjs"
Cohesion: 0.14
Nodes (12): normalizePhone(), CallerIdProviderError, firstFiniteNumber(), https, normalizeNullableText(), parseTruecallerHtml(), TruecallerProvider, fs (+4 more)

### Community 6 - "notifyPaymentAssociationRequired"
Cohesion: 0.29
Nodes (12): associateAutomaticPaymentEvent(), automaticPaymentCandidates(), ensurePaymentAutomationCollections(), evaluateAutomaticPayment(), formatColombiaDateTime(), makeAutomaticPaymentRecord(), normalisePaymentIdentifier(), notifyPaymentAssociationRequired() (+4 more)

### Community 7 - "MiApto.jsx"
Cohesion: 0.13
Nodes (19): BUILDING_CAMERAS, IntercomCallModal(), intercomRequest(), BUILDING_CAMERAS, colombiaTime(), IntercomCallPage(), publicRequest(), APTO_CAMERAS (+11 more)

### Community 8 - "startServer"
Cohesion: 0.06
Nodes (57): accessRateAllowed(), appendAccessEvent(), archiveCloudInboundMedia(), automaticPaymentIsRentOnly(), cameraDefinitions(), cloudConfig(), cloudGraphRequest(), cloudMediaKind() (+49 more)

### Community 9 - "scripts"
Cohesion: 0.05
Nodes (36): oxlint, devDependencies, oxlint, playwright, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+28 more)

### Community 10 - "continuidad.cjs"
Cohesion: 0.13
Nodes (12): autoBlock, bitacoraFile, { execFileSync }, fs, modified, path, pendientesFile, porcelain (+4 more)

### Community 11 - "cloudServiceAmounts"
Cohesion: 0.16
Nodes (29): buildDebtReply(), clearUtilityFinancing(), cloudServiceAmounts(), cloudServiceDisplayBlock(), cloudServiceReference(), cloudServiceState(), gasRecordHasNoVisibleInvoice(), latestUtilityRecord() (+21 more)

### Community 12 - "handleCloudInbound"
Cohesion: 0.08
Nodes (56): acknowledgePaymentProof(), addCloudMessage(), apartmentIdFromReference(), authorizedCloudContact(), blockCloudUser(), clearAdminAgentMode(), cloudAdminGreeting(), cloudAdminPaymentReminderTemplateData() (+48 more)

### Community 13 - "extension/manifest.json"
Cohesion: 0.07
Nodes (29): action, default_icon, default_popup, default_title, background, service_worker, content_scripts, 128 (+21 more)

### Community 14 - "api.js"
Cohesion: 0.14
Nodes (19): CLOUD_COLLECTIONS, createItem(), currentAuthToken(), deleteItem(), getDataVersion(), lastCloudSyncStatus, markLocalMutation(), serverReq() (+11 more)

### Community 15 - "getAuth"
Cohesion: 0.15
Nodes (27): AdminRoute(), ProtectedRoute(), Chat(), authHeaders(), DATO_LABELS, fmtDate(), fmtMoney(), getPredialUrl() (+19 more)

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
Cohesion: 0.17
Nodes (25): pdf-parse, amountCandidates(), analysePaymentProofMedia(), analyseText(), detectProvider(), extractDate(), extractPdfScreenshots(), extractPdfText() (+17 more)

### Community 20 - "sleep"
Cohesion: 0.15
Nodes (27): clickVisibleButton(), clickVisiblePortalButtonByText(), executePortalTurnstile(), getPortalCredentials(), gotoPortalPage(), inspectWaterPage(), launchBrowser(), loginGasWithPortalApi() (+19 more)

### Community 21 - "content-facebook.js"
Cohesion: 0.25
Nodes (22): activate(), autoFill(), checkAndRun(), chooseDropdown(), fillAndConfirmAddress(), fillAndConfirmAddressReliable(), findAndSet(), findDropdown() (+14 more)

### Community 22 - "Utilities.jsx"
Cohesion: 0.18
Nodes (21): billConvenioDebt(), billInteger(), billMeta(), billMoney(), billMonthDebt(), billPaymentChangeLabel(), billStatusText(), billTotalDebt() (+13 more)

### Community 23 - "restore-media-s3.cjs"
Cohesion: 0.28
Nodes (8): fs, main(), path, r2Config(), root, { S3Client, ListObjectsV2Command, GetObjectCommand }, streamToBuffer(), TARGETS

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
Cohesion: 0.16
Nodes (27): refreshAllFromServer(), startCloudPolling(), startDataVersionPolling(), stopCloudPolling(), stopDataVersionPolling(), ERROR_TEXT, GitHubAuth(), broadcastTakeover() (+19 more)

### Community 35 - "release-apk.cjs"
Cohesion: 0.23
Nodes (11): bumpVersion(), fs, gradleFile, main(), path, readVersion(), root, run() (+3 more)

### Community 36 - "sftp-sync-vm.py"
Cohesion: 0.80
Nodes (4): ensure(), main(), put_dir(), put_file()

### Community 37 - "test-marketplace-api.cjs"
Cohesion: 0.22
Nodes (10): child, fs, os, path, project, request(), run(), { spawn } (+2 more)

### Community 38 - "check-secrets.cjs"
Cohesion: 0.40
Nodes (3): missingRequired, OPTIONAL, REQUIRED

### Community 39 - "ThemeSelector.jsx"
Cohesion: 0.32
Nodes (11): iconMap, ThemeSelector(), applyTheme(), getTheme(), getThemeInfo(), initTheme(), loadThemeFromServer(), setTheme() (+3 more)

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

### Community 47 - "vm-job-inspect.cjs"
Cohesion: 0.40
Nodes (4): db, fs, logs, want

### Community 48 - "sync-graph-aiven.cjs"
Cohesion: 0.33
Nodes (6): dbUrl(), fs, main(), path, root, strict

### Community 49 - "2. Paso a Paso de la Migración"
Cohesion: 0.18
Nodes (10): 1. Datos de tu Servidor Oracle VM, 2. Paso a Paso de la Migración, 3. Resumen de Ventajas Obtenidas, GUÍA COMPLETA: ORACLE VM ALWAYS FREE (149.130.160.116), PASO 1: Conectarse a la VM, PASO 2: Sincronizar los archivos del proyecto a la VM, PASO 3: Ejecutar el Instalador Automático, PASO 4: Configuración en Cloudflare (Dominio y SSL) (+2 more)

### Community 50 - "matchPortalApartmentForService"
Cohesion: 0.33
Nodes (7): logUnmatchedPortalItems(), matchPortalApartment(), matchPortalApartmentForService(), normalizeDigits(), portalCodeValues(), portalDiagnosticReferences(), portalIdentifierValues()

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
Cohesion: 0.11
Nodes (36): activeContractForApartment(), activeContractForTenant(), buildAdminDebtReport(), buildCloudDetailedGlobalServicesReport(), buildCloudGlobalServicesReport(), cloudAdminPaymentReminderText(), cloudApartmentServices(), cloudCalendarDate() (+28 more)

### Community 68 - "set-camera-codes.cjs"
Cohesion: 0.40
Nodes (3): configPath, fs, path

### Community 70 - "waitForRenderedPortal"
Cohesion: 0.50
Nodes (5): portalUiStatus(), queryRenderedGasContract(), queryRenderedTripleAPolicy(), selectRenderedGasContract(), waitForRenderedPortal()

### Community 71 - "note-vm-change.cjs"
Cohesion: 0.47
Nodes (5): { execFileSync }, fs, git(), main(), readToken()

### Community 72 - "config.js"
Cohesion: 0.09
Nodes (34): react, getServerVersion(), Admin(), dayKey(), fmtBytes(), fmtDate(), Apartments(), Login() (+26 more)

### Community 80 - "_stream_supervisor"
Cohesion: 0.16
Nodes (16): _expire_stale_pauses(), list_cameras(), _playlist_age_s(), Edad en segundos del contenido HLS más reciente (playlist o segmento con…, Borra segmentos .ts viejos (>max_age_s) y vacíos (0 B): limpia pilas rancias…, Inicia el subproceso FFmpeg para streaming continuo HLS en disco/RAM., Sub-stream liviano para tiles: misma receta -c copy, canal 102., Detiene el sub-stream de una cámara. (+8 more)

### Community 81 - "truecaller-verify-otp.cjs"
Cohesion: 0.40
Nodes (3): fs, path, truecaller

### Community 82 - "caller-id-repository.cjs"
Cohesion: 0.26
Nodes (13): createClaimNextJob(), Database, enqueueLookup(), fs, getCallerCache(), getLatestJob(), initDatabase(), markJob() (+5 more)

### Community 83 - "trigger_alpr_scan"
Cohesion: 0.29
Nodes (8): capture_best_frame(), capture_snapshot(), _frame_sharpness(), Escaneo manual con Plate Recognizer Cloud: mode = 'compare' (nube; comparativa…, Extrae un fotograma JPEG nítido instantáneamente desde el último segmento TS en…, Nitidez por varianza del Laplaciano (mayor = más nítido)., Ráfaga para placas en movimiento (motos): extrae N frames del segmento más…, trigger_alpr_scan()

### Community 85 - "get"
Cohesion: 0.15
Nodes (20): _alpr_bump_usage(), _alpr_register_auto(), _alpr_today(), _alpr_usage(), _alpr_usage_file(), _alpr_worker(), disambiguate_colombian_plate(), download_recording() (+12 more)

### Community 89 - "ezviz_stream_server.py"
Cohesion: 0.12
Nodes (15): datetime, alpr_auto_status(), _fetch_range_to_file(), get_live_playlist(), get_retention(), _oldest_for_cam(), _playback_url(), _probe_range_has_data() (+7 more)

### Community 99 - "Historial de Cambios"
Cohesion: 0.08
Nodes (24): 2026-07-20 — v2.1.0 — Chat, dark mode, cloud-first, editor embebido, refactor mayor, 2026-07-20 — v2.1.1 — Fix crítico: carga datos cloud-first (setCollectionData mutación in-place, useState faltante, protección arrays vacíos, reset-db), 2026-07-21 — v2.2.0 — Chat presence fix, Dashboard imprevistos, auto-guardado contratos, campos trabajo inquilinos, 2026-07-22 — v2.3.0 — Temas pastel inmersivos, antecedentes policiales, predial, PostgreSQL, QR escáner, 2026-07-23 — v2.4.0 — Chrome Extension: auto-fill Facebook Marketplace con fotos, 2026-07-23 — v2.4.1 — Extension v1.4.1: fix dropdown menu close race condition + backup, 2026-07-23 — v2.4.2 — Extension v1.4.3: fix address field detection, fix laundry dropdown false match, 2026-07-23 — v2.4.3 — Extension v1.4.4: scope address query to form, reorder laundry options, exclude address field from dropdown search (+16 more)

### Community 100 - "Extensión de Chrome — Llenar Laujim"
Cohesion: 0.12
Nodes (16): Arquitectura, Backup de referencia, Configuración actual de dropdowns (v1.4.5), Extensión de Chrome — Llenar Laujim, Flujo de `chooseDropdown` (v1.4.5), Gestión de anuncios, Instalación, La app no carga en el navegador (+8 more)

### Community 101 - "VehicleStationaryTracker"
Cohesion: 0.33
Nodes (3): Rastreador espacial de vehículos. Determina si un vehículo está en movimiento o…, Determina si debemos llamar a la API Cloud o si está estacionado., VehicleStationaryTracker

### Community 102 - "set-local-pass.cjs"
Cohesion: 0.18
Nodes (10): actual, crypto, digest, ex, expected, fs, j, parts (+2 more)

### Community 103 - "crop_best_vehicle"
Cohesion: 0.50
Nodes (4): crop_best_vehicle(), YOLOv8n lazy (None si no instalado: se usa el frame completo)., Recorta el vehículo/moto más grande (margen 10%). Retorna (crop_path, (ox, oy,…, _yolo_model()

### Community 104 - "2. Modos de ejecución"
Cohesion: 0.18
Nodes (11): 1. Instalar dependencias, 2. Modos de ejecución, 3. Compilar APK Android, 4. Sincronizar Seeds, Build de producción, Desarrollo (red local), Desarrollo (solo este PC), Instalación y Uso (+3 more)

### Community 105 - "ApartmentDetail.jsx"
Cohesion: 0.08
Nodes (34): api, Modal(), COLORS, CustomTooltip(), getChartData(), getPaymentStatus(), PaymentHistoryChart(), StatsCard() (+26 more)

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

### Community 122 - "scrape-predial.cjs"
Cohesion: 0.43
Nodes (7): cleanText(), fieldAfter(), LABELS, main(), parseMoney(), parseVigencias(), scrapePredial()

### Community 123 - "sendCloudGlobalServices"
Cohesion: 0.24
Nodes (12): buildCloudFinancingImageData(), buildCloudServicesImageData(), cloudFinancingReportHtml(), cloudImageMoney(), cloudReportDateLabel(), cloudServicesReportHtml(), configuredCloudApartments(), createCloudFinancingReportMedia() (+4 more)

### Community 126 - "generate-proposal.cjs"
Cohesion: 0.50
Nodes (3): fs, path, targetPath

### Community 128 - "harness-continuity.cjs"
Cohesion: 0.28
Nodes (8): arg(), bitacoraFile, { execFileSync, spawnSync }, fs, git(), main(), path, root

### Community 152 - "Persistencia PostgreSQL"
Cohesion: 0.50
Nodes (4): Configuración SSL, Esquema, Flujo, Persistencia PostgreSQL

### Community 155 - "Settings.jsx"
Cohesion: 0.12
Nodes (36): Settings(), addCalendarReminder(), downloadICS(), fmtDate(), generateAllPaymentReminders(), generateICS(), getStoredUIDs(), nextDueDate() (+28 more)

### Community 157 - "_enrich_job_live"
Cohesion: 0.50
Nodes (4): _enrich_job_live(), Lee out_time_ms del archivo -progress de ffmpeg. Retorna segundos o -1 si no…, Agrega tamaño en vivo y % recalculado al vuelo para jobs downloading., _read_ffmpeg_progress()

### Community 160 - "Restauración ante desastre (VM perdida o disco muerto)"
Cohesion: 0.29
Nodes (6): Acceso multi-PC (Tailscale, indefinido), Dónde trabaja la IA en la VM (dos carpetas, no mezclar), Notas, Reconstrucción (VM Ubuntu nueva), Requisitos previos (guardados FUERA de la VM, gestor de claves), Restauración ante desastre (VM perdida o disco muerto)

### Community 162 - "App.jsx"
Cohesion: 0.15
Nodes (21): getCloudSyncStatus(), PrivateApp(), Layout(), navItems, initDB(), ContractGenerator(), Payments(), ShareApartments() (+13 more)

### Community 163 - "IntercomDoorbell.jsx"
Cohesion: 0.29
Nodes (8): IntercomDoorbell(), playDoorChime(), publicRequest(), enhanceAudioStream(), getPeerSignal(), postSignal(), startIntercomCall(), STUN_SERVERS

### Community 179 - "cdp-drive.py"
Cohesion: 0.67
Nodes (5): evaluate(), find_tab(), http(), main(), tabs()

### Community 180 - "handoff.cjs"
Cohesion: 0.18
Nodes (8): { execFileSync }, fs, graphCommit, graphFile, headShort, path, porcelain, root

### Community 182 - "opencode-bridge.cjs"
Cohesion: 0.09
Nodes (28): AGENT_CATALOG, AGENT_MIME, agentConfig(), agentOutboxFiles(), cleanAgentOutput(), CONTEXT_FILES, fs, getAgentModel() (+20 more)

## Knowledge Gaps
- **594 isolated node(s):** `fs`, `os`, `path`, `SERVER`, `TOKEN` (+589 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **59 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `installFailoverFetch()` connect `ScraperWorker.jsx` to `App.jsx`?**
  _High betweenness centrality (0.151) - this node is a cross-community bridge._
- **Why does `init()` connect `ScraperWorker.jsx` to `services-scraper.cjs`?**
  _High betweenness centrality (0.151) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `react`, `@tailwindcss/vite`, `truecallerjs`, `@sparticuz/chromium`, `scripts`, `payment-receipt-ocr.cjs`, `@capacitor/android`, `@capacitor/core`, `contractGenerator.js`, `@capacitor/filesystem`, `@capacitor/local-notifications`, `@capacitor-mlkit/barcode-scanning`, `@capacitor/share`, `hls.js`, `libphonenumber-js`, `node-cron`, `pizzip`, `tailwindcss`, `jsqr`, `lucide-react`, `docxtemplater`, `ffmpeg-static`, `express`, `react-dom`, `puppeteer-core`, `dexie`, `react-router-dom`, `multer`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `startServer()` (e.g. with `log()` and `publicEdgeView()`) actually correct?**
  _`startServer()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `fs`, `os`, `path` to the rest of the system?**
  _594 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `server.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.03271604938271605 - nodes in this community are weakly interconnected._
- **Should `fb-publisher.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1310483870967742 - nodes in this community are weakly interconnected._