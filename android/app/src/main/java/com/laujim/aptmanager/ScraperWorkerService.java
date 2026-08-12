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
import java.util.List;
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
    private static final String CHANNEL_ID = "laujim_scraper_worker";
    private static final int NOTIFICATION_ID = 31778;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 35_000;
    // Keep the portal window open for the requested three-minute allowance.
    private static final long WEBVIEW_TIMEOUT_MS = 180_000L;
    private static final String AUTH_CAPTURE_SCRIPT = "(function(){if(window.__LaujimAuthHookInstalled)return;window.__LaujimAuthHookInstalled=true;const send=function(value){try{if(value&&window.LaujimAndroidBridge&&typeof window.LaujimAndroidBridge.captureAuthorization==='function')window.LaujimAndroidBridge.captureAuthorization(String(value));}catch(e){}};const read=function(headers){if(!headers)return '';try{if(typeof headers.get==='function')return headers.get('Authorization')||headers.get('authorization')||'';if(Array.isArray(headers)){for(const item of headers){if(item&&String(item[0]).toLowerCase()==='authorization')return item[1]||'';}}for(const key of Object.keys(headers)){if(key.toLowerCase()==='authorization')return headers[key]||'';}}catch(e){}return '';};const originalFetch=window.fetch;if(typeof originalFetch==='function')window.fetch=function(input,init){send(read(init&&init.headers)||read(input&&input.headers));return originalFetch.apply(this,arguments);};try{const proto=XMLHttpRequest.prototype;const originalSet=proto.setRequestHeader;proto.setRequestHeader=function(name,value){if(String(name||'').toLowerCase()==='authorization')send(value);return originalSet.apply(this,arguments);};}catch(e){}})();";

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ExecutorService executor;
    private WebView webView;
    private CompletableFuture<Boolean> pageReady;
    private final Object javascriptResultLock = new Object();
    private CompletableFuture<String> javascriptResult;
    private String runnerScript;
    // Provider portals keep bearer tokens in JavaScript memory. Capture the
    // authorization header inside this phone WebView for the local runner.
    private volatile String nativeAuthorization = "";

    @Override
    public void onCreate() {
        super.onCreate();
        executor = Executors.newSingleThreadExecutor();
        createNotificationChannel();
        // PortalBrowserActivity owns the single shared WebView. Creating a
        // second hidden WebView loses the portal SPA's in-memory session and
        // makes Triple A render its shell without any policies.
        try {
            runnerScript = readAsset("portal-scraper.js");
        } catch (IOException error) {
            runnerScript = "";
            ScraperWorkerStore.setRunState(ScraperWorkerService.this, "error", "No se pudo cargar el motor local: " + error.getMessage());
        }
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
                CompletableFuture<Boolean> ready = pageReady;
                if (ready != null && !ready.isDone()) ready.complete(true);
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
            return START_NOT_STICKY;
        }
        if (running.compareAndSet(false, true)) executor.execute(() -> runLocalScrape(startId));
        return START_NOT_STICKY;
    }

    private void runLocalScrape(int startId) {
        int nextHours = ScraperWorkerStore.intervalHours(this);
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
            addAppEvent(diagnosticEvents, null, "run_started", "info", "La app inició una ejecución local.", -1, 0, 0, null);
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
            JSONObject schedule = config.optJSONObject("schedule");
            if (schedule != null) {
                nextHours = ScraperWorkerStore.clampHours(schedule.optInt("intervalHours", nextHours));
                ScraperWorkerStore.setIntervalHours(this, nextHours);
            }

            registerLocalWorker(server, token, deviceId, schedule == null ? null : schedule.optJSONArray("providers"));
            addAppEvent(diagnosticEvents, null, "register", "success", "La app quedó registrada como worker.", 200, 0, 0, null);
            flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
            JSONArray providers = schedule == null ? new JSONArray().put("air-e").put("water").put("gas") : schedule.optJSONArray("providers");
            if (providers == null || providers.length() == 0) providers = new JSONArray().put("air-e").put("water").put("gas");
            List<JSONObject> results = new ArrayList<>();
            String firstIssue = null;
            for (int index = 0; index < providers.length(); index += 1) {
                String provider = providers.optString(index, "").trim().toLowerCase();
                if (!provider.equals("air-e") && !provider.equals("water") && !provider.equals("gas")) continue;
                nativeAuthorization = "";
                ScraperWorkerStore.setCurrentProvider(this, provider);
                updateNotification("Consultando " + providerLabel(provider) + " en el teléfono…", provider);
                ScraperWorkerStore.setRunState(this, "running-" + provider, "");
                long providerStartedAt = System.currentTimeMillis();
                addAppEvent(diagnosticEvents, provider, "portal_start", "info", "Inició navegación y evaluación del portal.", -1, providerStartedAt, 0, null);
                flushAppEvents(server, token, deviceId, runId, diagnosticEvents);
                JSONObject outcome;
                try {
                    outcome = runProvider(provider, config);
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
                    JSONArray failureRecords = failureRecords(provider, config, outcome, noDataMessage);
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
            if (ScraperWorkerStore.enabled(this)) ScraperWorkerAlarm.scheduleNext(this, nextHours * 60L * 60L * 1000L);
            mainHandler.post(() -> {
                if (webView != null) webView.stopLoading();
            });
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelfResult(startId);
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
        String[] keys = {"state", "stage", "policyCount", "matchedPolicies", "unmatchedPolicies", "contractCount", "matchedContracts", "unmatchedContracts", "unmatchedApartments", "uiFailures", "invoiceFailures", "missingContractIds", "domRows", "domParagraphs", "domTextLength", "hydrationWaitMs", "url", "title", "fetchError"};
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
            .put("appVersion", "1.0.18")
            .put("providers", scheduleProviders == null ? new JSONArray() : scheduleProviders)
            .put("replaceExisting", false);
        HttpResult result = request(server + "/worker/v1/register", "POST", token, deviceId, registration.toString());
        if (result.status < 200 || result.status >= 300) throw new IllegalStateException("No se pudo registrar el worker local (HTTP " + result.status + ").");
    }

    private JSONObject runProvider(String provider, JSONObject config) throws Exception {
        // Open the authenticated data route so the portal itself refreshes its
        // session token. Loading only /login leaves NextAuth/Gascaribe tokens
        // unavailable to the local runner and produces false 401/fetch errors.
        if (runnerScript == null || runnerScript.isEmpty()) {
            return new JSONObject().put("state", "error").put("provider", provider).put("stage", "shared_webview").put("message", "El motor local de portales no estÃ¡ disponible.").put("results", new JSONArray());
        }
        String encoded = PortalBrowserActivity
            .executeScraper(provider, config == null ? "{}" : config.toString(), runnerScript)
            .get(WEBVIEW_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        JSONObject outcome = parseJsJson(encoded);
        return outcome == null ? new JSONObject().put("state", "error").put("message", "El portal no devolvió una respuesta local.") : outcome;
    }

    private String portalWorkUrl(String provider) {
        String normalized = provider == null ? "" : provider.trim().toLowerCase();
        if ("water".equals(normalized)) return "https://portal.aaa.com.co/polizas";
        if ("gas".equals(normalized)) return "https://portal.gascaribe.com/contracts";
        return PortalBrowserActivity.portalUrl(provider);
    }

    private void captureAuthorization(String url, java.util.Map<String, String> headers) {
        if (url == null || headers == null) return;
        String lowerUrl = url.toLowerCase();
        if (!lowerUrl.contains("portal.aaa.com.co")
            && !lowerUrl.contains("gascaribe")
            && !lowerUrl.contains("innovacion-gascaribe.com")) return;
        for (java.util.Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null && "authorization".equalsIgnoreCase(entry.getKey())
                && entry.getValue() != null && !entry.getValue().trim().isEmpty()) {
                nativeAuthorization = entry.getValue().trim();
                return;
            }
        }
    }

    private void installAuthorizationHook(WebView view) {
        if (view == null) return;
        mainHandler.post(() -> {
            try { view.evaluateJavascript(AUTH_CAPTURE_SCRIPT, ignored -> { }); }
            catch (Exception ignored) { }
        });
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
        String service = "air-e".equals(provider) ? "electricity" : "water".equals(provider) ? "water" : "gas";
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
                record.put("waterPaymentUrl", "https://portal.aaa.com.co/polizas");
            } else {
                record.put("gasPaymentCode", apartment.optString("gasPaymentCode", ""));
                record.put("gasPaymentUrl", "https://portal.gascaribe.com/payments");
            }
            records.put(record);
        }
        return records;
    }

    private JSONObject loadAndEvaluate(String provider, String url, JSONObject config) throws Exception {
        CompletableFuture<Boolean> loaded = new CompletableFuture<>();
        pageReady = loaded;
        mainHandler.post(() -> {
            if (webView != null) webView.loadUrl(url);
            else loaded.completeExceptionally(new IllegalStateException("WebView local no inicializado."));
        });
        try { loaded.get(WEBVIEW_TIMEOUT_MS, TimeUnit.MILLISECONDS); }
        catch (Exception error) { throw new IllegalStateException("Timeout cargando " + providerLabel(provider) + "."); }
        pageReady = null;

        CompletableFuture<String> result = new CompletableFuture<>();
        synchronized (javascriptResultLock) {
            javascriptResult = result;
        }
        String configJson = config.toString();
        String nativeAuthorizationJson = quote(nativeAuthorization);
        String expression = "(async()=>{try{window.__LaujimNativeAuthorization=" + nativeAuthorizationJson + ";" + runnerScript + "if(!window.LaujimLocalPortalScraper||typeof window.LaujimLocalPortalScraper.run!=='function')throw new Error('Motor local de portales no disponible.');const outcome=await window.LaujimLocalPortalScraper.run(" + quote(provider) + "," + configJson + ");window.LaujimAndroidBridge.resolve(JSON.stringify(outcome));}catch(e){window.LaujimAndroidBridge.resolve(JSON.stringify({state:'error',provider:" + quote(provider) + ",message:String(e&&e.message||e),results:[]}));}})();";
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

    private String providerLabel(String provider) {
        if ("water".equals(provider)) return "Triple A";
        if ("gas".equals(provider)) return "Gases del Caribe";
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
    public void onDestroy() {
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
            if (value != null && !value.trim().isEmpty()) nativeAuthorization = value.trim();
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
