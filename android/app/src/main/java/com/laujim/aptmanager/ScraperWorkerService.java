package com.laujim.aptmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONTokener;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Local Android portal worker. The WebView belongs to Laujim and uses the
 * phone's own network, cookies and Chromium engine. Render only receives the
 * sanitized results through the worker API; no Browserless connection is
 * opened here.
 */
public class ScraperWorkerService extends Service {
    public static final String ACTION_RUN = "com.laujim.aptmanager.SCRAPER_WORKER_RUN";
    public static final String ACTION_RUN_GAS_ACCOUNT = "com.laujim.aptmanager.SCRAPER_WORKER_RUN_GAS_ACCOUNT";
    public static final String EXTRA_GAS_ACCOUNT_ID = "gasAccountId";
    private static final String CHANNEL_ID = "laujim_scraper_worker";
    private static final int NOTIFICATION_ID = 31778;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 35_000;
    // Keep the portal window open for the requested three-minute allowance.
    private static final long WEBVIEW_TIMEOUT_MS = 180_000L;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ExecutorService executor;
    private WebView webView;
    private CompletableFuture<Boolean> pageReady;
    private final Object javascriptResultLock = new Object();
    private CompletableFuture<String> javascriptResult;
    private String runnerScript;
    private volatile String webViewProvider = "";
    private volatile String webViewWorkUrl = "";
    private volatile boolean storageRestoreAttempted;
    private volatile int webViewGeneration;
    private volatile boolean normalStopRequested;
    // Provider portals keep bearer tokens in JavaScript memory. Capture the
    // authorization header inside this phone WebView for the local runner.
    private volatile String nativeAuthorization = "";

    @Override
    public void onCreate() {
        super.onCreate();
        executor = Executors.newSingleThreadExecutor();
        createNotificationChannel();
        // Air-e and Gases keep the 1.0.17 local-worker path. Triple A is the
        // only provider that runs in the visible portal WebView because its
        // authenticated policy selector lives in the hydrated SPA DOM.
        try {
            runnerScript = readAsset("portal-scraper.js");
        } catch (IOException error) {
            runnerScript = "";
            ScraperWorkerStore.setRunState(ScraperWorkerService.this, "error", "No se pudo cargar el motor local: " + error.getMessage());
        }
        createLocalWebView();
        startForeground(NOTIFICATION_ID, notification("Worker local preparado", null));
    }

    private void createLocalWebView() {
        webView = new WebView(getApplicationContext());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        // Keep the exact Android WebView user agent used by PortalBrowserActivity.
        // Turnstile sessions can be tied to the browser fingerprint/user agent;
        // adding a worker-only suffix made a visible login look authenticated
        // while the background WebView was treated as a different client.
        webView.setVisibility(View.INVISIBLE);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new JavascriptResultBridge(), "LaujimAndroidBridge");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                installAuthorizationHook(view);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                captureAuthorization(
                    request == null || request.getUrl() == null ? null : request.getUrl().toString(),
                    request == null ? null : request.getRequestHeaders()
                );
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                PortalSessionVault.flushCookies();
                installAuthorizationHook(view);
                final int generation = webViewGeneration;
                final String currentProvider = webViewProvider;
                if (!storageRestoreAttempted && isProviderUrl(url, currentProvider)) {
                    storageRestoreAttempted = true;
                    String state = PortalSessionVault.loadState(ScraperWorkerService.this, currentProvider);
                    if (!state.isEmpty()) {
                        view.evaluateJavascript(PortalSessionVault.restoreScript(state), ignored ->
                            mainHandler.postDelayed(() -> {
                                if (webView != null && generation == webViewGeneration) webView.loadUrl(webViewWorkUrl);
                            }, 250L));
                        return;
                    }
                }
                storageRestoreAttempted = true;
                captureSessionLater(view, currentProvider, generation, 600L);
                captureSessionLater(view, currentProvider, generation, 3_000L);
                mainHandler.postDelayed(() -> {
                    if (generation != webViewGeneration) return;
                    CompletableFuture<Boolean> ready = pageReady;
                    if (ready != null && !ready.isDone()) ready.complete(true);
                }, 1_500L);
            }
        });
        try {
            runnerScript = readAsset("portal-scraper.js");
        } catch (IOException error) {
            runnerScript = "";
            ScraperWorkerStore.setRunState(ScraperWorkerService.this, "error", "No se pudo cargar el motor local: " + error.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!ScraperWorkerStore.enabled(this)) {
            stopSelfResult(startId);
            return START_REDELIVER_INTENT;
        }
        String triggerSource = intent == null ? "android" : intent.getStringExtra("triggerSource");
        if (triggerSource == null || triggerSource.trim().isEmpty()) triggerSource = "android";
        if (running.compareAndSet(false, true)) {
            final String source = triggerSource;
            ScraperWorkerStore.setSchedulerEvent(this, "service_started", source, "El servicio inició la consulta común de los proveedores habilitados.");
            ScraperWorkerSchedule.scheduleNextAlarm(this, "service-started");
            final String gasAccountId = intent == null ? "" : intent.getStringExtra(EXTRA_GAS_ACCOUNT_ID);
            executor.execute(() -> runLocalScrape(startId, source, gasAccountId));
        } else {
            ScraperWorkerStore.setSchedulerEvent(this, "service_already_running", triggerSource, "Se ignoró una activación porque los portales todavía estaban en ejecución.");
        }
        return START_REDELIVER_INTENT;
    }

    private void runLocalScrape(int startId, String triggerSource, String requestedGasAccountId) {
        int nextHours = ScraperWorkerStore.intervalHours(this);
        boolean scheduleChanged = false;
        String server = "";
        String token = "";
        String deviceId = "";
        String runId = "android-local-" + UUID.randomUUID();
        List<JSONObject> diagnosticEvents = new ArrayList<>();
        try {
            server = trimServer(ScraperWorkerStore.serverUrl(this));
            token = ScraperWorkerStore.token(this);
            deviceId = ScraperWorkerStore.deviceId(this);
            if (server.isEmpty() || token.isEmpty() || deviceId.isEmpty()) {
                throw new IllegalStateException("Falta configurar URL, token o dispositivo.");
            }
            if (runnerScript == null || runnerScript.isEmpty()) {
                throw new IllegalStateException("El motor local de portales no está disponible en esta APK.");
            }

            ScraperWorkerStore.setRunState(this, "connecting", "");
            JSONObject schedulerDetails = new JSONObject()
                .put("triggerSource", triggerSource)
                .put("intervalHours", ScraperWorkerStore.intervalHours(this))
                .put("startAt", ScraperWorkerStore.startAt(this))
                .put("timezone", ScraperWorkerStore.timezone(this))
                .put("nextRunAt", ScraperWorkerStore.iso(ScraperWorkerStore.nextRunAt(this)))
                .put("scheduleMode", ScraperWorkerStore.scheduleMode(this));
            addAppEvent(diagnosticEvents, null, "run_started", "info", "La app inició una ejecución programada común para Air-e, Triple A y Gases.", -1, 0, 0, schedulerDetails);
            flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
            updateNotification("Conectando con Laujim…", null);
            long configStartedAt = System.currentTimeMillis();
            HttpResult configResult = request(server + "/worker/v1/config", "GET", token, deviceId, null);
            addAppEvent(diagnosticEvents, null, "config_fetch", configResult.status >= 200 && configResult.status < 300 ? "success" : "error", "Respuesta de configuración de Render.", configResult.status, configStartedAt, 0, null);
            flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
            if (configResult.status < 200 || configResult.status >= 300) {
                throw new IllegalStateException("Render respondió HTTP " + configResult.status + ".");
            }
            JSONObject config = parseObject(configResult.body);
            HttpResult credentialResult = request(server + "/worker/v1/portal-credentials", "GET", token, deviceId, null);
            if (credentialResult.status >= 200 && credentialResult.status < 300) {
                JSONObject credentialPayload = parseObject(credentialResult.body);
                JSONObject portalCredentials = credentialPayload.optJSONObject("credentials");
                if (portalCredentials != null) config.put("portalCredentials", portalCredentials);
                addAppEvent(diagnosticEvents, null, "credentials_fetch", "success", "La app recibió las credenciales privadas para recuperar sesiones vencidas.", credentialResult.status, 0, 0,
                    new JSONObject().put("configuredProviders", portalCredentials == null ? 0 : portalCredentials.length()));
            } else {
                addAppEvent(diagnosticEvents, null, "credentials_fetch", "warn", "No se pudieron obtener credenciales para recuperar sesiones; se conservará el flujo de sesión existente.", credentialResult.status, 0, 0, null);
            }
            flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
            JSONObject schedule = config.optJSONObject("schedule");
            if (schedule != null) {
                nextHours = ScraperWorkerStore.clampHours(schedule.optInt("intervalHours", nextHours));
                scheduleChanged = ScraperWorkerStore.setSchedule(
                    this,
                    nextHours,
                    schedule.optString("startAt", ScraperWorkerStore.startAt(this)),
                    schedule.optString("timezone", ScraperWorkerStore.timezone(this))
                );
            }

            registerLocalWorker(server, token, deviceId, schedule == null ? null : schedule.optJSONArray("providers"));
            addAppEvent(diagnosticEvents, null, "register", "success", "La app quedó registrada como worker.", 200, 0, 0, null);
            flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
            JSONArray providers = schedule == null ? new JSONArray().put("air-e").put("water").put("gas") : schedule.optJSONArray("providers");
            List<String> executionProviders = buildProviderRuns(providers, config, requestedGasAccountId);
            List<JSONObject> results = new ArrayList<>();
            String firstIssue = null;
            for (String provider : executionProviders) {
                JSONObject providerConfig = scopedConfig(config, provider);
                nativeAuthorization = "";
                ScraperWorkerStore.setCurrentProvider(this, provider);
                updateNotification("Consultando " + providerLabel(provider) + " en el teléfono…", provider);
                ScraperWorkerStore.setRunState(this, "running-" + provider, "");
                long providerStartedAt = System.currentTimeMillis();
                addAppEvent(diagnosticEvents, provider, "portal_start", "info", "Inició navegación y evaluación del portal.", -1, providerStartedAt, 0, null);
                flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
                JSONObject outcome;
                try {
                    outcome = runProvider(provider, providerConfig);
                } catch (Exception providerError) {
                    String providerMessage = providerError.getMessage() == null
                        ? "Error local desconocido del portal."
                        : providerError.getMessage();
                    // One portal must not abort the remaining providers. The
                    // failure is converted into records below and the next
                    // portal gets its own WebView attempt.
                    outcome = new JSONObject()
                        .put("state", "error")
                        .put("provider", provider)
                        .put("message", providerMessage)
                        .put("results", new JSONArray());
                }
                String state = outcome.optString("state", "error");
                JSONArray providerResults = outcome.optJSONArray("results");
                if (providerResults != null) {
                    for (int item = 0; item < providerResults.length(); item += 1) {
                        JSONObject record = providerResults.optJSONObject(item);
                        if (record != null) results.add(record);
                    }
                }
                if (providerResults == null || providerResults.length() == 0) {
                    String noDataMessage = outcome.optString("message", "El portal no devolvió datos confirmados.");
                    if (firstIssue == null) firstIssue = noDataMessage;
                    updateNotification(noDataMessage, provider);
                    JSONArray failureRecords = failureRecords(provider, providerConfig, outcome, noDataMessage);
                    for (int item = 0; item < failureRecords.length(); item += 1) {
                        JSONObject record = failureRecords.optJSONObject(item);
                        if (record != null) results.add(record);
                    }
                }
                JSONObject outcomeDetails = diagnosticDetails(outcome);
                addAppEvent(
                    diagnosticEvents,
                    provider,
                    outcome.optString("stage", "portal_result"),
                    "ok".equals(state) ? "success" : ("warning".equals(state) || "needs_verification".equals(state) ? "warn" : "error"),
                    outcome.optString("message", "El portal terminó sin mensaje."),
                    outcome.has("httpStatus") ? outcome.optInt("httpStatus", -1) : -1,
                    providerStartedAt,
                    providerResults == null ? 0 : providerResults.length(),
                    outcomeDetails
                );
                flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
                if (!"ok".equals(state) && firstIssue == null) {
                    firstIssue = outcome.optString("message", "El portal no devolvió datos.");
                    updateNotification(firstIssue, provider);
                }
            }

            if (!results.isEmpty()) {
                JSONObject body = new JSONObject()
                    .put("deviceId", deviceId)
                    .put("runId", runId)
                    .put("capturedAt", new java.util.Date().toInstant().toString())
                    .put("results", new JSONArray(results));
                addAppEvent(diagnosticEvents, null, "results_prepare", "info", "La app prepara los resultados locales para Render.", -1, 0, results.size(), null);
                flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
                long resultsStartedAt = System.currentTimeMillis();
                HttpResult pushed = request(server + "/worker/v1/results", "POST", token, deviceId, body.toString());
                JSONObject receiptDetails = parseReceiptDetails(pushed.body);
                addAppEvent(diagnosticEvents, null, "results_upload", pushed.status >= 200 && pushed.status < 300 ? "success" : "error", pushed.status >= 200 && pushed.status < 300 ? serverReceiptMessage(pushed, results) : "Render rechazó la entrega de resultados.", pushed.status, resultsStartedAt, results.size(), receiptDetails);
                flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
                if (pushed.status < 200 || pushed.status >= 300) throw new IllegalStateException("No se pudieron enviar los resultados (HTTP " + pushed.status + ").");
                ScraperWorkerStore.setRunState(this, firstIssue == null ? "completed" : "completed-with-warning", firstIssue == null ? "" : firstIssue);
                updateNotification(serverReceiptMessage(pushed, results), null);
            } else {
                HttpResult heartbeat = request(server + "/worker/v1/heartbeat", "POST", token, deviceId,
                    new JSONObject().put("deviceId", deviceId).put("platform", "android").put("runtime", "laujim-local-webview").toString());
                addAppEvent(diagnosticEvents, null, "results_upload", heartbeat.status >= 200 && heartbeat.status < 300 ? "warn" : "error", "No hubo resultados para enviar; se envió heartbeat a Render.", heartbeat.status, 0, 0, null);
                flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
                String issue = firstIssue == null ? "No hubo resultados confirmados en esta ejecución." : firstIssue;
                ScraperWorkerStore.setRunState(this, "needs-attention", issue);
                updateNotification(issue, null);
            }
        } catch (Exception error) {
            String message = error.getMessage() == null ? "Error local desconocido" : error.getMessage();
            addAppEvent(diagnosticEvents, null, "run_error", "error", message, -1, 0, 0, null);
            flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
            ScraperWorkerStore.setRunState(this, "error", message);
            updateNotification("Error del scraper local: " + message, null);
        } finally {
            ScraperWorkerStore.setCurrentProvider(this, "");
            running.set(false);
            if (ScraperWorkerStore.enabled(this)) {
                if (scheduleChanged) ScraperWorkerSchedule.scheduleAll(this, "server-schedule-changed");
                else ScraperWorkerSchedule.scheduleNextAlarm(this, "run-finished");
            }
            mainHandler.post(() -> {
                if (webView != null) webView.stopLoading();
            });
            normalStopRequested = true;
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private void addAppEvent(List<JSONObject> events, String provider, String stage, String level, String message, int httpStatus, long startedAt, int records, JSONObject details) {
        if (events == null) return;
        try {
            JSONObject event = new JSONObject()
                .put("provider", provider == null ? JSONObject.NULL : provider)
                .put("stage", stage == null || stage.trim().isEmpty() ? "general" : stage)
                .put("level", level == null || level.trim().isEmpty() ? "info" : level)
                .put("message", message == null ? "Evento sin mensaje." : message)
                .put("eventAt", new java.util.Date().toInstant().toString());
            if (httpStatus >= 0) event.put("httpStatus", httpStatus);
            if (startedAt > 0) event.put("durationMs", Math.max(0, System.currentTimeMillis() - startedAt));
            if (records >= 0) event.put("records", records);
            if (details != null && details.length() > 0) event.put("details", details);
            events.add(event);
        } catch (JSONException ignored) {
        }
    }

    private void flushAppEvents(String server, String token, String deviceId, String runId, List<JSONObject> events) {
        if (events == null || events.isEmpty() || server == null || server.isEmpty() || token == null || token.isEmpty() || deviceId == null || deviceId.isEmpty()) return;
        JSONArray batch = new JSONArray();
        for (JSONObject event : events) batch.put(event);
        events.clear();
        try {
            request(server + "/worker/v1/events", "POST", token, deviceId,
                new JSONObject().put("deviceId", deviceId).put("runId", runId).put("events", batch).toString());
        } catch (Exception ignored) {
            // Diagnostics must never stop the portal scrape. The native status
            // and final result upload remain the source of truth if this call
            // is temporarily unavailable.
        }
    }

    private JSONObject diagnosticDetails(JSONObject outcome) {
        if (outcome == null) return null;
        JSONObject details = new JSONObject();
        String[] keys = {"state", "stage", "executionPath", "policyCount", "matchedPolicies", "unmatchedPolicies", "contractCount", "matchedContracts", "unmatchedContracts", "unmatchedApartments", "uiFailures", "invoiceFailures", "missingContractIds", "domRows", "domParagraphs", "domTextLength", "hydrationWaitMs", "url", "title", "fetchError"};
        for (String key : keys) {
            if (!outcome.has(key)) continue;
            try { details.put(key, outcome.opt(key)); } catch (JSONException ignored) { }
        }
        return details.length() == 0 ? null : details;
    }

    private JSONObject parseReceiptDetails(String body) {
        try {
            JSONObject receipt = parseObject(body);
            JSONObject details = new JSONObject();
            String[] keys = {"received", "accepted", "confirmed", "issueCount", "persisted", "rejectedCount", "truncated"};
            for (String key : keys) if (receipt.has(key)) details.put(key, receipt.opt(key));
            return details.length() == 0 ? null : details;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void registerLocalWorker(String server, String token, String deviceId, JSONArray scheduleProviders) throws Exception {
        JSONObject registration = new JSONObject()
            .put("deviceId", deviceId)
            .put("platform", "android")
            .put("runtime", "laujim-local-webview")
            .put("appVersion", installedAppVersion())
            .put("providers", scheduleProviders == null ? new JSONArray() : scheduleProviders)
            .put("replaceExisting", false);
        HttpResult result = request(server + "/worker/v1/register", "POST", token, deviceId, registration.toString());
        if (result.status < 200 || result.status >= 300) throw new IllegalStateException("No se pudo registrar el worker local (HTTP " + result.status + ").");
    }

    /** Expands the single scheduled gas provider into one run per portal account. */
    private List<String> buildProviderRuns(JSONArray configured, JSONObject config, String requestedGasAccountId) {
        LinkedHashSet<String> runs = new LinkedHashSet<>();
        String requested = normalizeGasAccountId(requestedGasAccountId);
        if (!requested.isEmpty()) {
            runs.add(requested);
            return new ArrayList<>(runs);
        }

        boolean gasEnabled = false;
        if (configured != null) {
            for (int index = 0; index < configured.length(); index += 1) {
                String provider = configured.optString(index, "").trim().toLowerCase();
                if ("gas".equals(provider)) gasEnabled = true;
                else if ("air-e".equals(provider) || "water".equals(provider)) runs.add(provider);
            }
        }
        if (gasEnabled) {
            LinkedHashSet<String> accounts = new LinkedHashSet<>();
            JSONArray apartments = config == null ? null : config.optJSONArray("apartments");
            if (apartments != null) {
                for (int index = 0; index < apartments.length(); index += 1) {
                    JSONObject apartment = apartments.optJSONObject(index);
                    if (apartment == null || apartment.optString("gasPaymentCode", "").trim().isEmpty()) continue;
                    String account = normalizeGasAccountId(apartment.optString("gasAccountId", ""));
                    accounts.add(account.isEmpty() ? "gas-1" : account);
                }
            }
            if (accounts.isEmpty()) accounts.add("gas-1");
            runs.addAll(accounts);
        }
        if (runs.isEmpty()) {
            runs.add("air-e");
            runs.add("water");
            runs.add("gas-1");
        }
        return new ArrayList<>(runs);
    }

    /** Keeps a gas-account failure from generating errors for the other account. */
    private JSONObject scopedConfig(JSONObject config, String provider) throws JSONException {
        if (config == null) return null;
        JSONObject scoped = new JSONObject(config.toString());
        JSONObject allCredentials = config.optJSONObject("portalCredentials");
        if (allCredentials != null) {
            String normalized = provider == null ? "" : provider.trim().toLowerCase();
            String credentialKey = isGasAccountId(normalized)
                ? normalized
                : ("water".equals(normalized) ? "water" : "air-e");
            JSONObject credentials = allCredentials.optJSONObject(credentialKey);
            if (credentials == null && "gas-1".equals(normalized)) credentials = allCredentials.optJSONObject("gas-1");
            if (credentials != null) scoped.put("credentials", new JSONObject(credentials.toString()));
            scoped.remove("portalCredentials");
        }
        if (!isGasAccountId(provider)) return scoped;
        JSONArray source = config.optJSONArray("apartments");
        JSONArray selected = new JSONArray();
        if (source != null) {
            for (int index = 0; index < source.length(); index += 1) {
                JSONObject apartment = source.optJSONObject(index);
                if (apartment == null || apartment.optString("gasPaymentCode", "").trim().isEmpty()) continue;
                String configuredAccount = normalizeGasAccountId(apartment.optString("gasAccountId", ""));
                if (configuredAccount.isEmpty()) configuredAccount = "gas-1";
                if (provider.equals(configuredAccount)) selected.put(apartment);
            }
        }
        scoped.put("apartments", selected);
        scoped.put("gasAccountId", provider);
        return scoped;
    }

    private String normalizeGasAccountId(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase();
        return normalized.matches("gas-\\d+") ? normalized : "";
    }

    private boolean isGasAccountId(String value) {
        return normalizeGasAccountId(value).length() > 0;
    }

    private JSONObject runProvider(String provider, JSONObject config) throws Exception {
        JSONObject outcome = null;
        // A successful form submission navigates away from the login page and
        // destroys that JavaScript context. Re-enter the portal from native
        // code, at most twice, so the authenticated scrape resumes safely.
        for (int attempt = 0; attempt < 3; attempt += 1) {
            outcome = runProviderAttempt(provider, config);
            if (outcome == null || !"login_submitted".equals(outcome.optString("state", ""))) break;
            if (attempt >= 1) {
                return new JSONObject()
                    .put("state", "needs_login")
                    .put("provider", PortalSessionVault.baseProvider(provider))
                    .put("stage", "auto_login_retry_limit")
                    .put("message", providerLabel(provider) + " no confirmó el inicio de sesión automático. Revisa las credenciales o completa la verificación visible.")
                    .put("results", new JSONArray());
            }
            Thread.sleep(10_000L);
        }
        return outcome == null
            ? new JSONObject().put("state", "error").put("message", "El portal no devolvió una respuesta local.")
            : outcome;
    }

    private JSONObject runProviderAttempt(String provider, JSONObject config) throws Exception {
        String normalized = provider == null ? "" : provider.trim().toLowerCase();
        if (PortalSessionVault.isGasSession(normalized)) {
            // Gases is stable on the legacy background path. Keep it isolated
            // while Air-e and Triple A reuse the authenticated visible view.
            JSONObject outcome = loadAndEvaluate(provider, portalWorkUrl(provider), config);
            return outcome == null ? new JSONObject().put("state", "error").put("message", "El portal no devolvió una respuesta local.") : outcome;
        }

        // Air-e and Triple A first reuse the visible authenticated SPA. If
        // Android reclaimed it, recover the encrypted per-origin state in the
        // background WebView so an hourly run does not depend on RAM alone.
        if (runnerScript == null || runnerScript.isEmpty()) {
            return new JSONObject().put("state", "error").put("provider", provider).put("stage", "shared_webview").put("message", "El motor local de portales no está disponible.").put("results", new JSONArray());
        }
        JSONObject outcome;
        if (PortalBrowserActivity.hasActiveBrowser()) {
            try {
                String encoded = PortalBrowserActivity
                    .executeScraper(provider, config == null ? "{}" : config.toString(), runnerScript)
                    .get(WEBVIEW_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                outcome = parseJsJson(encoded);
                if (outcome != null) outcome.put("executionPath", "authenticated-visible-webview");
            } catch (TimeoutException error) {
                PortalBrowserActivity.cancelPendingScraper("La consulta de " + providerLabel(provider) + " agotó los 3 minutos y fue liberada.");
                throw new IllegalStateException("Timeout ejecutando " + providerLabel(provider) + " en el teléfono.");
            } catch (Exception error) {
                Throwable cause = error.getCause() == null ? error : error.getCause();
                String detail = cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
                if (detail.toLowerCase().contains("ya hay una consulta de portal")) {
                    PortalBrowserActivity.cancelPendingScraper("Se limpió una consulta anterior que quedó bloqueada.");
                }
                throw error;
            }
        } else {
            outcome = loadAndEvaluate(provider, portalWorkUrl(provider), config);
            if (outcome != null) outcome.put("executionPath", "persistent-background-webview");
        }
        return outcome == null ? new JSONObject().put("state", "error").put("message", "El portal no devolvió una respuesta local.") : outcome;
    }

    private String portalWorkUrl(String provider) {
        return PortalBrowserActivity.portalWorkUrl(provider);
    }

    private void captureAuthorization(String url, java.util.Map<String, String> headers) {
        if (url == null || headers == null) return;
        String lowerUrl = url.toLowerCase();
        if (!lowerUrl.contains("portal.aaa.com.co")
            && !lowerUrl.contains("portal.air-e.com")
            && !lowerUrl.contains("gascaribe")
            && !lowerUrl.contains("innovacion-gascaribe.com")) return;
        for (java.util.Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null && "authorization".equalsIgnoreCase(entry.getKey())
                && entry.getValue() != null && !entry.getValue().trim().isEmpty()) {
                nativeAuthorization = entry.getValue().trim();
                PortalSessionVault.saveAuthorization(this, webViewProvider, nativeAuthorization);
                return;
            }
        }
    }

    private void installAuthorizationHook(WebView view) {
        if (view == null) return;
        mainHandler.post(() -> {
            try { view.evaluateJavascript(PortalSessionVault.authorizationCaptureScript("LaujimAndroidBridge"), ignored -> { }); }
            catch (Exception ignored) { }
        });
    }

    private void captureSessionLater(WebView view, String provider, int generation, long delayMs) {
        mainHandler.postDelayed(() -> {
            if (view == null || webView == null || generation != webViewGeneration || !isProviderUrl(view.getUrl(), provider)) return;
            try { view.evaluateJavascript(PortalSessionVault.snapshotScript(provider, "LaujimAndroidBridge"), ignored -> { }); }
            catch (RuntimeException ignored) { }
        }, delayMs);
    }

    private boolean isProviderUrl(String url, String provider) {
        String lower = String.valueOf(url == null ? "" : url).toLowerCase();
        String normalized = PortalSessionVault.baseProvider(provider);
        if ("water".equals(normalized)) return lower.contains("portal.aaa.com.co");
        if ("gas".equals(normalized)) return lower.contains("portal.gascaribe.com") || lower.contains("innovacion-gascaribe.com");
        return lower.contains("portal.air-e.com");
    }

    private JSONArray failureRecords(String provider, JSONObject config, JSONObject outcome, String message) throws JSONException {
        JSONArray records = new JSONArray();
        JSONArray apartments = config == null ? null : config.optJSONArray("apartments");
        if (apartments == null) return records;
        String normalizedMessage = String.valueOf(message == null ? "" : message);
        String state = outcome == null ? "error" : outcome.optString("state", "error");
        String status = "needs_verification".equals(state) || normalizedMessage.matches("(?is).*(captcha|turnstile|verificaci[oó]n).*")
            ? "captcha"
            : normalizedMessage.matches("(?is).*timeout|tiempo.*") ? "timeout" : "error";
        String providerName = providerLabel(provider);
        String service = "air-e".equals(PortalSessionVault.baseProvider(provider)) ? "electricity" : "water".equals(PortalSessionVault.baseProvider(provider)) ? "water" : "gas";
        for (int index = 0; index < apartments.length(); index += 1) {
            JSONObject apartment = apartments.optJSONObject(index);
            if (apartment == null) continue;
            JSONObject record = new JSONObject()
                .put("provider", providerName)
                .put("service", service)
                .put("apartmentId", apartment.opt("id"))
                .put("apartment", apartment.optString("name", ""))
                .put("status", status)
                .put("deudaCOP", JSONObject.NULL)
                .put("deudaTotalCOP", JSONObject.NULL)
                .put("deudaLabel", "Deuda Total")
                .put("error", normalizedMessage)
                .put("checkedAt", new java.util.Date().toInstant().toString())
                .put("scrapedAt", new java.util.Date().toInstant().toString());
            if ("air-e".equals(provider)) {
                record.put("nic", apartment.optString("electricityPaymentCode", ""));
            } else if ("water".equals(provider)) {
                record.put("waterPaymentCode", apartment.optString("waterPaymentCode", ""));
                String paymentUrl = apartment.optString("waterPaymentUrl", "");
                if (!paymentUrl.isEmpty()) record.put("waterPaymentUrl", paymentUrl);
            } else {
                record.put("gasPaymentCode", apartment.optString("gasPaymentCode", ""));
                String paymentUrl = apartment.optString("gasPaymentUrl", "");
                if (!paymentUrl.isEmpty()) record.put("gasPaymentUrl", paymentUrl);
            }
            records.put(record);
        }
        return records;
    }

    private JSONObject loadAndEvaluate(String provider, String url, JSONObject config) throws Exception {
        CompletableFuture<Boolean> loaded = new CompletableFuture<>();
        String previousProvider = webViewProvider;
        webViewProvider = PortalSessionVault.normalize(provider);
        PortalSessionVault.activateCookieSession(this, previousProvider, webViewProvider);
        webViewWorkUrl = url;
        storageRestoreAttempted = false;
        webViewGeneration += 1;
        PortalSessionVault.flushCookies();
        nativeAuthorization = PortalSessionVault.loadAuthorization(this, webViewProvider);
        pageReady = loaded;
        mainHandler.post(() -> {
            if (webView != null) webView.loadUrl(url);
            else loaded.completeExceptionally(new IllegalStateException("WebView local no inicializado."));
        });
        try { loaded.get(WEBVIEW_TIMEOUT_MS, TimeUnit.MILLISECONDS); }
        catch (Exception error) { throw new IllegalStateException("Timeout cargando " + providerLabel(provider) + "."); }
        pageReady = null;

        String restoredAuthorization = PortalSessionVault.loadAuthorization(this, webViewProvider);
        if (!restoredAuthorization.isEmpty()) nativeAuthorization = restoredAuthorization;

        CompletableFuture<String> result = new CompletableFuture<>();
        synchronized (javascriptResultLock) {
            javascriptResult = result;
        }
        String configJson = config.toString();
        String nativeAuthorizationJson = quote(nativeAuthorization);
        String runnerProvider = PortalSessionVault.baseProvider(provider);
        String expression = "(async()=>{try{window.__LaujimNativeAuthorization=" + nativeAuthorizationJson + ";" + runnerScript + "if(!window.LaujimLocalPortalScraper||typeof window.LaujimLocalPortalScraper.run!=='function')throw new Error('Motor local de portales no disponible.');const outcome=await window.LaujimLocalPortalScraper.run(" + quote(runnerProvider) + "," + configJson + ");window.LaujimAndroidBridge.resolve(JSON.stringify(outcome));}catch(e){window.LaujimAndroidBridge.resolve(JSON.stringify({state:'error',provider:" + quote(runnerProvider) + ",message:String(e&&e.message||e),results:[]}));}})();";
        mainHandler.postDelayed(() -> {
            if (webView == null) {
                result.completeExceptionally(new IllegalStateException("WebView local no inicializado."));
                return;
            }
            try {
                // evaluateJavascript does not reliably await an async Promise;
                // the bridge above completes the future after the portal runner
                // has actually finished.
                webView.evaluateJavascript(expression, ignored -> { });
            } catch (Exception error) {
                result.completeExceptionally(error);
            }
        }, 1_000L);
        try {
            String encoded = result.get(WEBVIEW_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            JSONObject parsed = parseJsJson(encoded);
            if (parsed == null) throw new IllegalStateException("El WebView no devolvió una respuesta válida de " + providerLabel(provider) + ".");
            return parsed;
        } catch (TimeoutException error) {
            throw new IllegalStateException("Timeout ejecutando " + providerLabel(provider) + " en el teléfono.");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Ejecución interrumpida en " + providerLabel(provider) + ".");
        } catch (Exception error) {
            Throwable cause = error.getCause() == null ? error : error.getCause();
            String detail = cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
            throw new IllegalStateException("No se pudo ejecutar " + providerLabel(provider) + ": " + detail);
        } finally {
            synchronized (javascriptResultLock) {
                if (javascriptResult == result) javascriptResult = null;
            }
        }
    }

    private JSONObject parseJsJson(String encoded) throws JSONException {
        String raw = encoded == null ? "" : encoded.trim();
        if (raw.isEmpty() || "null".equals(raw) || "undefined".equals(raw)) return null;
        Object value = new JSONTokener(raw).nextValue();
        if (value instanceof String) value = new JSONTokener((String) value).nextValue();
        return value instanceof JSONObject ? (JSONObject) value : null;
    }

    private String quote(String value) {
        return JSONObject.quote(value == null ? "" : value);
    }

    private String serverReceiptMessage(HttpResult pushed, List<JSONObject> localResults) {
        int localIssues = 0;
        for (JSONObject result : localResults) {
            String status = result == null ? "" : result.optString("status", "");
            if ("error".equalsIgnoreCase(status) || "captcha".equalsIgnoreCase(status) || "timeout".equalsIgnoreCase(status)) {
                localIssues += 1;
            }
        }
        try {
            JSONObject receipt = parseObject(pushed.body);
            int received = receipt.optInt("received", localResults.size());
            int accepted = receipt.optInt("accepted", received);
            int confirmed = receipt.optInt("confirmed", Math.max(0, accepted - localIssues));
            int issueCount = receipt.optInt("issueCount", localIssues);
            int persisted = receipt.optInt("persisted", accepted);
            int rejected = receipt.optInt("rejectedCount", Math.max(0, received - accepted));
            StringBuilder message = new StringBuilder()
                .append("Servidor: ").append(received)
                .append(" recibidos, ").append(accepted)
                .append(" aceptados, ").append(confirmed)
                .append(" confirmados, ").append(issueCount)
                .append(" con incidencia, ").append(persisted)
                .append(" persistidos");
            JSONObject byProvider = receipt.optJSONObject("acceptedByProvider");
            if (byProvider != null && byProvider.length() > 0) {
                message.append(" (");
                java.util.Iterator<String> keys = byProvider.keys();
                boolean first = true;
                while (keys.hasNext()) {
                    String key = keys.next();
                    if (!first) message.append(", ");
                    message.append(key).append(":").append(byProvider.optInt(key, 0));
                    first = false;
                }
                message.append(")");
            }
            if (rejected > 0) message.append(" · rechazados: ").append(rejected);
            if (localIssues > 0) message.append(" · errores de portal: ").append(localIssues);
            return message.toString();
        } catch (Exception ignored) {
            return "Servidor: recibidos " + localResults.size() + " resultado(s) locales." +
                (localIssues > 0 ? " Errores de portal: " + localIssues + "." : "");
        }
    }

    private HttpResult request(String url, String method, String token, String deviceId, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("X-Worker-Token", token);
        connection.setRequestProperty("X-Worker-Id", deviceId);
        if (body != null) {
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 400 ? connection.getInputStream() : connection.getErrorStream();
        String response = readBody(stream);
        connection.disconnect();
        return new HttpResult(status, response);
    }

    private String readBody(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder value = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null && value.length() < 1_000_000) value.append(line);
        }
        return value.toString();
    }

    private String readAsset(String name) throws IOException {
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open(name), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) output.append(line).append('\n');
        }
        return output.toString();
    }

    private JSONObject parseObject(String body) throws JSONException { return new JSONObject(body == null ? "{}" : body); }

    private String trimServer(String value) {
        String result = value == null ? "" : value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        if (result.endsWith("/api")) result = result.substring(0, result.length() - 4);
        return result;
    }

    private String installedAppVersion() {
        try {
            android.content.pm.PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName == null ? "unknown" : info.versionName;
        } catch (android.content.pm.PackageManager.NameNotFoundException ignored) {
            return "unknown";
        }
    }

    private String providerLabel(String provider) {
        String normalized = PortalSessionVault.normalize(provider);
        if ("water".equals(normalized)) return "Triple A";
        if (PortalSessionVault.isGasSession(normalized)) {
            if (normalized.matches("gas-\\d+")) return "Gases del Caribe · Cuenta " + normalized.substring(4);
            return "Gases del Caribe";
        }
        return "Air-e";
    }

    private Notification notification(String message, String provider) {
        Intent launch = new Intent(this, provider == null ? MainActivity.class : PortalBrowserActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (provider != null) launch.putExtra(PortalBrowserActivity.EXTRA_PROVIDER, provider);
        PendingIntent pending = PendingIntent.getActivity(this, provider == null ? 31779 : provider.hashCode(), launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("Laujim · Scraper local")
            .setContentText(message)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateNotification(String message, String provider) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification(message, provider));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Scraper local de Laujim", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Consultas locales de los portales de servicios públicos.");
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (ScraperWorkerStore.enabled(this)) {
            ScraperWorkerStore.setSchedulerEvent(this, "service_task_removed", "android", "Android retiró la tarea; se reconstruyó la alarma y el respaldo WorkManager.");
            ScraperWorkerSchedule.scheduleAll(this, "service-task-removed");
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (ScraperWorkerStore.enabled(this) && !normalStopRequested) {
            ScraperWorkerStore.setSchedulerEvent(this, "service_destroyed", "android", "El servicio terminó inesperadamente; se reconstruyó el scheduler local.");
            ScraperWorkerSchedule.scheduleAll(this, "service-destroyed");
        }
        if (executor != null) executor.shutdownNow();
        mainHandler.post(() -> {
            if (webView != null) {
                webView.stopLoading();
                webView.destroy();
                webView = null;
            }
        });
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private final class JavascriptResultBridge {
        @JavascriptInterface
        public void captureAuthorization(String value) {
            if (value != null && !value.trim().isEmpty()) {
                nativeAuthorization = value.trim();
                PortalSessionVault.saveAuthorization(ScraperWorkerService.this, webViewProvider, nativeAuthorization);
            }
        }

        @JavascriptInterface
        public void persistSession(String provider, String value) {
            if (value == null || value.isEmpty()) return;
            PortalSessionVault.saveState(ScraperWorkerService.this, provider, value);
            PortalSessionVault.saveCookieSnapshot(ScraperWorkerService.this, provider);
            PortalSessionVault.flushCookies();
        }

        @JavascriptInterface
        public void resolve(String value) {
            CompletableFuture<String> pending;
            synchronized (javascriptResultLock) {
                pending = javascriptResult;
            }
            if (pending != null && !pending.isDone()) pending.complete(value);
        }
    }

    private static final class HttpResult {
        final int status;
        final String body;
        HttpResult(int status, String body) { this.status = status; this.body = body; }
    }
}
