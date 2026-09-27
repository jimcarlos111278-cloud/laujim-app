# Graph Report - C:\Users\jimca\OneDrive\Escritorio\test\Proyecto Laujim APP fix\scraper-graph  (2026-08-31)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 548 nodes · 1757 edges · 14 communities
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.54)
- Token cost: 869 input · 140 output

## Graph Freshness
- Built from commit: `eb3cf462`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Portal Scraper Logic
- Android WebView Bridge
- Scraper Worker Dispatcher
- Scraper Worker Service
- Browserless Configuration
- Scraper Task Scheduling
- Portal Interaction Utilities
- Worker Protocol Normalization
- Invoice Data Parsing
- Portal Result Matching
- Browser Launch Management
- Scrape Execution Flow
- Worker Execution Handler
- Portal Authentication UI

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

## Communities (14 total, 0 thin omitted)

### Community 0 - "Portal Scraper Logic"
Cohesion: 0.08
Nodes (94): airContractFromPage(), airEUiDebt(), allStrings(), amountFromFields(), amountFromKeyPattern(), apartmentNumber(), appendUnmatchedPortalResults(), attemptAutoLogin() (+86 more)

### Community 1 - "Android WebView Bridge"
Cohesion: 0.06
Nodes (16): Activity, Handler, Intent, JavascriptInterface, Override, WebView, PortalBridge, PortalBrowserActivity (+8 more)

### Community 2 - "Scraper Worker Dispatcher"
Cohesion: 0.08
Nodes (11): Context, ScraperWorkerDispatcher, ScraperWorkerPlugin, Context, SharedPreferences, ScraperWorkerStore, CapacitorPlugin, JSObject (+3 more)

### Community 3 - "Scraper Worker Service"
Cohesion: 0.08
Nodes (11): HttpResult, Handler, Intent, Override, WebView, ScraperWorkerService, IBinder, JSONArray (+3 more)

### Community 4 - "Browserless Configuration"
Cohesion: 0.06
Nodes (36): AIR_E_NIC_MAP, AIR_E_URLS, BROWSERLESS_REGION, BROWSERLESS_SOLVE_CAPTCHAS, BROWSERLESS_STEALTH, BROWSERLESS_TIMEOUT_MS, BROWSERLESS_TOKENS, BROWSERLESS_WS_ENDPOINT (+28 more)

### Community 5 - "Scraper Task Scheduling"
Cohesion: 0.14
Nodes (12): Context, Intent, Override, ScraperWorkerAlarmReceiver, Context, Intent, Override, ScraperWorkerBootReceiver (+4 more)

### Community 6 - "Portal Interaction Utilities"
Cohesion: 0.23
Nodes (24): attachBrowserlessCaptchaSolver(), clickVisiblePortalButtonByText(), closeWaterBrowser(), closeWaterResource(), executePortalTurnstile(), fetchGasDebtSummary(), fetchPortalJson(), getPortalCredentials() (+16 more)

### Community 7 - "Worker Protocol Normalization"
Cohesion: 0.24
Nodes (20): ALLOWED_STATUSES, crypto, gasContractPaymentUrl(), inspectWorkerResults(), isoOrNow(), normalizeAmount(), normalizeInteger(), normalizeProgress() (+12 more)

### Community 8 - "Invoice Data Parsing"
Cohesion: 0.18
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

### Community 12 - "Worker Execution Handler"
Cohesion: 0.29
Nodes (7): Context, Override, ScraperWorkerKickWorker, NonNull, Result, Worker, WorkerParameters

### Community 13 - "Portal Authentication UI"
Cohesion: 0.43
Nodes (8): clickVisibleButton(), loginPortalPage(), portalFrameRoots(), portalLoginDiagnostic(), typeVisibleField(), visibleHandle(), visibleSelectorExists(), waitForPortalAuthCompletion()

## Knowledge Gaps
- **23 isolated node(s):** `fs`, `os`, `path`, `puppeteer`, `cron` (+18 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `field()` connect `Portal Scraper Logic` to `Invoice Data Parsing`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `ScraperWorkerService` connect `Scraper Worker Service` to `Android WebView Bridge`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `portalFieldValue()` connect `Invoice Data Parsing` to `Portal Scraper Logic`, `Browserless Configuration`, `Portal Interaction Utilities`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `fs`, `os`, `path` to the rest of the system?**
  _23 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Portal Scraper Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.07882302405498282 - nodes in this community are weakly interconnected._
- **Should `Android WebView Bridge` be split into smaller, more focused modules?**
  _Cohesion score 0.06230847803881512 - nodes in this community are weakly interconnected._
- **Should `Scraper Worker Dispatcher` be split into smaller, more focused modules?**
  _Cohesion score 0.07916241062308478 - nodes in this community are weakly interconnected._