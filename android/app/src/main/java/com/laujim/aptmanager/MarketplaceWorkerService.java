package com.laujim.aptmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
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
 * Pulls one queued Marketplace job from Render and executes it in Android's
 * own WebView/session. No Facebook credentials or cookies leave the phone.
 */
public class MarketplaceWorkerService extends Service {
    public static final String ACTION_CHECK = "com.laujim.aptmanager.MARKETPLACE_CHECK";
    private static final String CHANNEL_ID = "laujim_marketplace_worker";
    private static final int NOTIFICATION_ID = 31781;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 40_000;
    private static final long WEBVIEW_TIMEOUT_MS = 240_000L;
    private static final AtomicBoolean RUNNING = new AtomicBoolean(false);

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object resultLock = new Object();
    private WebView webView;
    private String automationScript = "";
    private JSONObject currentJob;
    private CompletableFuture<String> javascriptResult;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForegroundCompat(notification("Buscando publicaciones pendientes…"));
        try { automationScript = readAsset("marketplace-worker.js"); }
        catch (IOException error) { automationScript = ""; }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!ScraperWorkerStore.enabled(this)) {
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }
        if (RUNNING.compareAndSet(false, true)) executor.execute(() -> runOnce(startId));
        return START_NOT_STICKY;
    }

    private void createWebView() {
        webView = new WebView(getApplicationContext());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new MarketplaceBridge(), "LaujimMarketplaceBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                pendingFileCallback = callback;
                executor.execute(MarketplaceWorkerService.this::deliverJobPhotos);
                return true;
            }
        });
    }

    private void runOnce(int startId) {
        String server = "";
        String token = "";
        String deviceId = "";
        String jobId = "";
        try {
            server = trimServer(ScraperWorkerStore.serverUrl(this));
            token = ScraperWorkerStore.token(this);
            deviceId = ScraperWorkerStore.deviceId(this);
            if (server.isEmpty() || token.isEmpty() || deviceId.isEmpty()) {
                throw new IllegalStateException("Falta configurar URL, token o dispositivo.");
            }
            if (automationScript.isEmpty()) throw new IllegalStateException("El motor local de Marketplace no está disponible.");
            ScraperWorkerStore.setMarketplaceRunState(this, "checking", "", "");
            HttpResult next = request(server + "/worker/v1/marketplace/jobs/next", "GET", token, deviceId, null);
            if (next.status < 200 || next.status >= 300) throw new IllegalStateException("Render respondió HTTP " + next.status + " al consultar Marketplace.");
            JSONObject envelope = new JSONObject(next.body == null || next.body.isEmpty() ? "{}" : next.body);
            currentJob = envelope.optJSONObject("job");
            if (currentJob == null) {
                ScraperWorkerStore.setMarketplaceRunState(this, "idle", "", "");
                updateNotification("Marketplace sin publicaciones pendientes.");
                return;
            }
            jobId = String.valueOf(currentJob.optInt("id"));
            postStatus(server, token, deviceId, jobId, "processing", "Abriendo el formulario local de Facebook.", null, null);
            ScraperWorkerStore.setMarketplaceRunState(this, "processing", "", jobId);
            updateNotification("Publicando apartamento " + currentJob.optString("apartmentName", "") + "…");

            JSONObject outcome = executeInAuthenticatedWebView(currentJob);
            JSONArray events = outcome.optJSONArray("events");
            if (events != null && events.length() > 0) postEvents(server, token, deviceId, jobId, events);
            String state = outcome.optString("state", "failed");
            String message = outcome.optString("message", "Marketplace terminó sin mensaje.");
            String listingUrl = outcome.optString("listingUrl", "");
            String serverState = "published".equals(state) ? "published"
                : "needs_login".equals(state) ? "needs_login"
                : "needs_review".equals(state) ? "needs_review" : "failed";
            postStatus(server, token, deviceId, jobId, serverState, message,
                "failed".equals(serverState) ? message : null, listingUrl);
            ScraperWorkerStore.setMarketplaceRunState(this, serverState,
                "published".equals(serverState) ? "" : message, jobId);
            if ("published".equals(serverState)) updateNotification("Publicación creada en Facebook Marketplace.");
            else updateNotification(message);
            if ("needs_login".equals(serverState) || "needs_review".equals(serverState)) openVisibleFacebook();
        } catch (Exception error) {
            String message = error.getMessage() == null ? "Error local de Marketplace." : error.getMessage();
            if (!jobId.isEmpty() && !server.isEmpty() && !token.isEmpty() && !deviceId.isEmpty()) {
                try { postStatus(server, token, deviceId, jobId, "failed", message, message, null); }
                catch (Exception ignored) { }
            }
            ScraperWorkerStore.setMarketplaceRunState(this, "error", message, jobId);
            updateNotification(message);
        } finally {
            currentJob = null;
            RUNNING.set(false);
            MarketplaceWorkerSchedule.schedule(this);
            stopForeground(STOP_FOREGROUND_DETACH);
            stopSelfResult(startId);
        }
    }

    private JSONObject executeInAuthenticatedWebView(JSONObject job) throws Exception {
        JSONObject listing = job.optJSONObject("listing");
        if (listing == null) listing = new JSONObject();
        if (MarketplaceBrowserActivity.hasActiveBrowser()) {
            String raw = MarketplaceBrowserActivity
                .executeJob(listing, job.optBoolean("publish", true), automationScript)
                .get(WEBVIEW_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            JSONObject outcome = new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
            outcome.put("executionPath", "authenticated-visible-webview");
            return outcome;
        }
        return new JSONObject()
            .put("state", "needs_login")
            .put("stage", "shared_webview_missing")
            .put("message", "Abre Facebook desde Laujim, conserva ese navegador y vuelve a pulsar Reintentar.")
            .put("events", new JSONArray().put(new JSONObject()
                .put("stage", "shared_webview_missing")
                .put("message", "El navegador autenticado de Facebook no estaba activo.")
                .put("eventAt", new java.util.Date().toInstant().toString())));
    }

    private JSONObject executeInWebView(JSONObject job) throws Exception {
        CompletableFuture<Boolean> loaded = new CompletableFuture<>();
        mainHandler.post(() -> {
            webView.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    if (!loaded.isDone()) loaded.complete(true);
                }
            });
            webView.loadUrl(MarketplaceBrowserActivity.CREATE_URL);
        });
        loaded.get(WEBVIEW_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        CompletableFuture<String> result = new CompletableFuture<>();
        synchronized (resultLock) { javascriptResult = result; }
        JSONObject listing = job.optJSONObject("listing");
        if (listing == null) listing = new JSONObject();
        String expression = "(async()=>{try{" + automationScript
            + "if(!window.LaujimMarketplaceWorker)throw new Error('Motor de Marketplace no disponible.');"
            + "const result=await window.LaujimMarketplaceWorker.run(" + listing + ",{publish:" + job.optBoolean("publish", true) + "});"
            + "window.LaujimMarketplaceBridge.resolve(JSON.stringify(result));"
            + "}catch(e){window.LaujimMarketplaceBridge.resolve(JSON.stringify({state:'failed',message:String(e&&e.message||e)}));}})();";
        mainHandler.postDelayed(() -> webView.evaluateJavascript(expression, ignored -> { }), 1_500L);
        try {
            String raw = result.get(WEBVIEW_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            return new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
        } catch (TimeoutException error) {
            return new JSONObject().put("state", "needs_review").put("message", "Facebook no terminó la publicación dentro de cuatro minutos.");
        } finally {
            synchronized (resultLock) { if (javascriptResult == result) javascriptResult = null; }
        }
    }

    private void deliverJobPhotos() {
        List<Uri> uris = new ArrayList<>();
        JSONObject listing = currentJob == null ? null : currentJob.optJSONObject("listing");
        JSONArray urls = listing == null ? null : listing.optJSONArray("photoUrls");
        File directory = new File(getCacheDir(), "marketplace-photos");
        if (!directory.exists()) directory.mkdirs();
        if (urls != null) {
            for (int index = 0; index < Math.min(10, urls.length()); index += 1) {
                String source = urls.optString(index, "");
                if (source.isEmpty()) continue;
                try {
                    File target = MarketplacePhotoUtils.downloadAndPrepare(
                        source, directory, "apartment_" + UUID.randomUUID(), CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS);
                    uris.add(FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", target));
                } catch (Exception error) {
                    updateNotification("No se pudo preparar una foto automáticamente.");
                }
            }
        }
        final Uri[] selected = uris.toArray(new Uri[0]);
        mainHandler.post(() -> {
            ValueCallback<Uri[]> callback = pendingFileCallback;
            pendingFileCallback = null;
            if (callback != null) callback.onReceiveValue(selected);
        });
    }

    private void postStatus(String server, String token, String deviceId, String jobId, String status, String message, String error, String listingUrl) throws Exception {
        JSONObject body = new JSONObject()
            .put("deviceId", deviceId)
            .put("status", status)
            .put("message", message == null ? JSONObject.NULL : message)
            .put("error", error == null ? JSONObject.NULL : error)
            .put("listingUrl", listingUrl == null ? JSONObject.NULL : listingUrl);
        HttpResult response = request(server + "/worker/v1/marketplace/jobs/" + jobId + "/status", "POST", token, deviceId, body.toString());
        if (response.status < 200 || response.status >= 300) throw new IOException("Render rechazó el estado de Marketplace (HTTP " + response.status + ").");
    }

    private void postEvents(String server, String token, String deviceId, String jobId, JSONArray events) throws Exception {
        JSONObject body = new JSONObject()
            .put("deviceId", deviceId)
            .put("events", events == null ? new JSONArray() : events);
        HttpResult response = request(server + "/worker/v1/marketplace/jobs/" + jobId + "/events", "POST", token, deviceId, body.toString());
        if (response.status < 200 || response.status >= 300) throw new IOException("Render rechazó los logs de Marketplace (HTTP " + response.status + ").");
    }

    private void openVisibleFacebook() {
        try {
            Intent intent = new Intent(this, MarketplaceBrowserActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            startActivity(intent);
        } catch (RuntimeException ignored) { }
    }

    private void waitForWebView() throws Exception {
        long deadline = System.currentTimeMillis() + 20_000L;
        while (webView == null && System.currentTimeMillis() < deadline) Thread.sleep(100L);
        if (webView == null) throw new IllegalStateException("Android no pudo crear el navegador local de Marketplace.");
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

    private String readBody(InputStream stream) throws IOException {
        if (stream == null) return "";
        StringBuilder value = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null && value.length() < 2_000_000) value.append(line);
        }
        return value.toString();
    }

    private String readAsset(String name) throws IOException {
        StringBuilder value = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open(name), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) value.append(line).append('\n');
        }
        return value.toString();
    }

    private String trimServer(String value) {
        String result = value == null ? "" : value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        if (result.endsWith("/api")) result = result.substring(0, result.length() - 4);
        return result;
    }

    private Notification notification(String message) {
        Intent launch = new Intent(this, MarketplaceBrowserActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, NOTIFICATION_ID, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("Laujim · Marketplace local")
            .setContentText(message)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pending)
            .build();
    }

    private void updateNotification(String message) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification(message));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Marketplace local de Laujim", NotificationManager.IMPORTANCE_LOW));
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NOTIFICATION_ID, notification);
    }

    @Override
    public void onDestroy() {
        executor.shutdownNow();
        mainHandler.post(() -> {
            if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(new Uri[0]);
            pendingFileCallback = null;
            if (webView != null) {
                webView.stopLoading();
                webView.destroy();
                webView = null;
            }
        });
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private final class MarketplaceBridge {
        @JavascriptInterface public void requestPhotos() {
            mainHandler.post(() -> {
                if (webView == null) return;
                webView.evaluateJavascript("(function(){var i=document.querySelector('input[type=file][accept*=image],input[type=file]');if(i)i.click();})();", ignored -> { });
            });
        }

        @JavascriptInterface public void resolve(String value) {
            CompletableFuture<String> pending;
            synchronized (resultLock) { pending = javascriptResult; }
            if (pending != null && !pending.isDone()) pending.complete(value);
        }
    }

    private static final class HttpResult {
        final int status;
        final String body;
        HttpResult(int status, String body) { this.status = status; this.body = body; }
    }
}
