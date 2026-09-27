# Graph Report - scraper-graph  (2026-09-01)

## Corpus Check
- 15 files · ~51,336 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 575 nodes · 1782 edges · 15 communities
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.54)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `eb3cf462`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Portal Scraper Logic
- PortalBrowserActivity
- ScraperWorkerStore
- ScraperWorkerService
- Browserless Configuration
- .onReceive
- Portal Interaction Utilities
- Worker Protocol Normalization
- Invoice Data Parsing
- Portal Result Matching
- Browser Launch Management
- Scrape Execution Flow
- Gases del Caribe — Método de extracción (referencia)
- Portal Authentication UI
- Worker portatil de servicios

## God Nodes (most connected - your core abstractions)
1. `ScraperWorkerService` - 57 edges
2. `ScraperWorkerStore` - 57 edges
3. `PortalBrowserActivity` - 41 edges
4. `scrapeGasAccount()` - 32 edges
5. `PortalSessionVault` - 27 edges
6. `scrapeTripleAAccount()` - 26 edges
7. `sleep()` - 23 edges
8. `runAirE()` - 20 edges
9. `ScraperWorkerPlugin` - 19 edges
10. `clean()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `portalFieldAmounts()` --indirect_call--> `field()`  [INFERRED]
  src/services-scraper.cjs → android/app/src/main/assets/portal-scraper.js
- `portalFieldValue()` --indirect_call--> `field()`  [INFERRED]
  src/services-scraper.cjs → android/app/src/main/assets/portal-scraper.js

## Import Cycles
- None detected.

## Communities (15 total, 0 thin omitted)

### Community 0 - "Portal Scraper Logic"
Cohesion: 0.08
Nodes (94): airContractFromPage(), airEUiDebt(), allStrings(), amountFromFields(), amountFromKeyPattern(), apartmentNumber(), appendUnmatchedPortalResults(), attemptAutoLogin() (+86 more)

### Community 1 - "PortalBrowserActivity"
Cohesion: 0.06
Nodes (16): Activity, Handler, Intent, JavascriptInterface, Override, WebView, PortalBridge, PortalBrowserActivity (+8 more)

### Community 2 - "ScraperWorkerStore"
Cohesion: 0.07
Nodes (12): ScraperWorkerPlugin, Context, ScraperWorkerSchedule, Context, SharedPreferences, ScraperWorkerStore, CapacitorPlugin, JSObject (+4 more)

### Community 3 - "ScraperWorkerService"
Cohesion: 0.08
Nodes (11): HttpResult, Handler, Intent, Override, WebView, ScraperWorkerService, IBinder, JSONArray (+3 more)

### Community 4 - "Browserless Configuration"
Cohesion: 0.06
Nodes (36): AIR_E_NIC_MAP, AIR_E_URLS, BROWSERLESS_REGION, BROWSERLESS_SOLVE_CAPTCHAS, BROWSERLESS_STEALTH, BROWSERLESS_TIMEOUT_MS, BROWSERLESS_TOKENS, BROWSERLESS_WS_ENDPOINT (+28 more)

### Community 5 - ".onReceive"
Cohesion: 0.10
Nodes (18): Context, Intent, Override, ScraperWorkerAlarmReceiver, Context, Intent, Override, ScraperWorkerBootReceiver (+10 more)

### Community 6 - "Portal Interaction Utilities"
Cohesion: 0.23
Nodes (24): attachBrowserlessCaptchaSolver(), clickVisiblePortalButtonByText(), closeWaterBrowser(), closeWaterResource(), executePortalTurnstile(), fetchGasDebtSummary(), fetchPortalJson(), getPortalCredentials() (+16 more)

### Community 7 - "Worker Protocol Normalization"
Cohesion: 0.24
Nodes (20): ALLOWED_STATUSES, crypto, gasContractPaymentUrl(), inspectWorkerResults(), isoOrNow(), normalizeAmount(), normalizeInteger(), normalizeProgress() (+12 more)

### Community 8 - "Invoice Data Parsing"
Cohesion: 0.19
Nodes (21): aggregateAirEInvoices(), fetchTripleAPortalSummary(), gasDebtSummary(), gasInvoiceSummary(), normalizePortalText(), parseAirEAmount(), parseCopAmount(), parsePortalAmount() (+13 more)

### Community 9 - "Portal Result Matching"
Cohesion: 0.15
Nodes (20): apartmentNumberFrom(), completePortalResults(), configuredApartmentTargets(), gasContractPaymentUrl(), matchPortalApartment(), matchPortalApartmentForService(), normalizeDigits(), portalCodeValues() (+12 more)

### Community 10 - "Browser Launch Management"
Cohesion: 0.18
Nodes (12): BROWSERLESS_PROFILES, browserlessEndpointCandidates(), browserlessEndpointFor(), configuredAirETargets(), contractFromAirEResources(), firstExistingPath(), getAirECredentials(), launchBrowser() (+4 more)

### Community 11 - "Scrape Execution Flow"
Cohesion: 0.26
Nodes (12): enqueueServiceBrowserRun(), isTransientPortalRunError(), notifyPersistedUtilityChanges(), persistGasResults(), persistResults(), persistUtilityResults(), persistWaterResults(), runGasScrapeOnce() (+4 more)

### Community 12 - "Gases del Caribe — Método de extracción (referencia)"
Cohesion: 0.11
Nodes (18): 1. Dos portales (límite de 10 cuentas), 2. Mapeo contrato → apartamento, 3. Facturas pendientes (julio 2026, mes actual), 4.1 Endpoint de deuda: `GET /contracts/debt/{contractId}`, 4.2 Endpoint de facturas: `GET /invoices/{contractId}`, 4. API del portal (cómo extraer los valores), 5. Autenticación (clave para que funcione), 6.1 Android (`android/app/src/main/assets/portal-scraper.js`) (+10 more)

### Community 13 - "Portal Authentication UI"
Cohesion: 0.43
Nodes (8): clickVisibleButton(), loginPortalPage(), portalFrameRoots(), portalLoginDiagnostic(), typeVisibleField(), visibleHandle(), visibleSelectorExists(), waitForPortalAuthCompletion()

### Community 14 - "Worker portatil de servicios"
Cohesion: 0.25
Nodes (7): Android, Cambiar de dispositivo, Configuracion de Render, Contrato HTTP, Objetivo, PC o VPS, Worker portatil de servicios

## Knowledge Gaps
- **42 isolated node(s):** `fs`, `os`, `path`, `puppeteer`, `cron` (+37 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `field()` connect `Portal Scraper Logic` to `Invoice Data Parsing`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `ScraperWorkerService` connect `ScraperWorkerService` to `PortalBrowserActivity`, `ScraperWorkerStore`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `portalFieldValue()` connect `Invoice Data Parsing` to `Portal Scraper Logic`, `Browserless Configuration`, `Portal Interaction Utilities`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `fs`, `os`, `path` to the rest of the system?**
  _42 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Portal Scraper Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.07860824742268041 - nodes in this community are weakly interconnected._
- **Should `PortalBrowserActivity` be split into smaller, more focused modules?**
  _Cohesion score 0.06251526251526252 - nodes in this community are weakly interconnected._
- **Should `ScraperWorkerStore` be split into smaller, more focused modules?**
  _Cohesion score 0.07141597601833892 - nodes in this community are weakly interconnected._