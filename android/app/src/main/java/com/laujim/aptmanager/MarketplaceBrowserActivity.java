package com.laujim.aptmanager;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Visible Facebook browser for login, 2FA and publication. Marketplace jobs
 * execute in this exact WebView so the authenticated SPA/session does not get
 * split between the login screen and a background browser.
 */
public class MarketplaceBrowserActivity extends Activity {
    static final String CREATE_URL = "https://www.facebook.com/marketplace/create/";
    private static final String LOGIN_URL = "https://www.facebook.com/login/?next=%2Fmarketplace%2Fcreate%2F";
    private static final String RECOVERY_URL = "https://www.facebook.com/login/identify/";
    private static final int PHOTO_PICKER_REQUEST = 31782;

    private static volatile MarketplaceBrowserActivity activeInstance;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object jobLock = new Object();
    private final JSONArray stageEvents = new JSONArray();
    private WebView webView;
    private TextView status;
    private CompletableFuture<String> pendingJobResult;
    private JSONObject currentListing;
    private ValueCallback<Uri[]> pendingFileCallback;
    private boolean jobEvaluationScheduled;
    private boolean storageRestoreAttempted;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        activeInstance = this;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(android.graphics.Color.WHITE);

        TextView title = new TextView(this);
        title.setText("Laujim · Facebook Marketplace");
        title.setTextColor(android.graphics.Color.rgb(20, 30, 45));
        title.setTextSize(18);
        title.setPadding(24, 20, 24, 8);
        root.addView(title, new LinearLayout.LayoutParams(-1, -2));

        status = new TextView(this);
        status.setText("Inicia sesión y completa el 2FA si Facebook lo solicita. Laujim nunca recibe tu contraseña.");
        status.setTextColor(android.graphics.Color.DKGRAY);
        status.setTextSize(13);
        status.setPadding(24, 0, 24, 12);
        root.addView(status, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout actions = new LinearLayout(this);
        actions.setPadding(16, 0, 16, 8);
        Button form = new Button(this);
        form.setText("Abrir formulario");
        form.setOnClickListener(view -> loadCreatePage());
        actions.addView(form, new LinearLayout.LayoutParams(0, -2, 1));
        Button login = new Button(this);
        login.setText("Iniciar sesión");
        login.setOnClickListener(view -> loadLoginPage());
        actions.addView(login, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(actions, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout sessionActions = new LinearLayout(this);
        sessionActions.setPadding(16, 0, 16, 8);
        Button reset = new Button(this);
        reset.setText("Reiniciar Facebook");
        reset.setOnClickListener(view -> resetFacebookSession());
        sessionActions.addView(reset, new LinearLayout.LayoutParams(0, -2, 1));
        Button recovery = new Button(this);
        recovery.setText("Recuperar en navegador");
        recovery.setOnClickListener(view -> openRecoveryInBrowser());
        sessionActions.addView(recovery, new LinearLayout.LayoutParams(0, -2, 1));
        Button close = new Button(this);
        close.setText("Volver a Laujim");
        close.setOnClickListener(view -> returnToLaujim());
        sessionActions.addView(close, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(sessionActions, new LinearLayout.LayoutParams(-1, -2));

        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        loadCreatePage();
    }

    @Override
    protected void onStart() {
        super.onStart();
        activeInstance = this;
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);
        view.addJavascriptInterface(new MarketplaceBridge(), "LaujimMarketplaceBridge");
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView page, ValueCallback<Uri[]> callback, FileChooserParams params) {
                pendingFileCallback = callback;
                if (hasAutomatedPhotoSelection()) {
                    executor.execute(MarketplaceBrowserActivity.this::deliverJobPhotos);
                } else {
                    openSystemPhotoPicker();
                }
                return true;
            }
        });
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView page, String url) {
                PortalSessionVault.flushCookies();
                String current = url == null ? "" : url;
                // Facebook login/recovery pages are sensitive to replayed
                // sessionStorage. WebView cookies are the authoritative
                // session; restoring an old SPA snapshot can loop on the
                // password-change spinner.
                storageRestoreAttempted = true;
                captureSession(800L);
                captureSession(3_500L);
                updateStatus(current);
                synchronized (jobLock) {
                    if (pendingJobResult != null && !pendingJobResult.isDone() && !jobEvaluationScheduled) {
                        jobEvaluationScheduled = true;
                        mainHandler.postDelayed(MarketplaceBrowserActivity.this::evaluatePendingJob, 3_500L);
                    }
                }
            }
        });
    }

    private void loadCreatePage() {
        if (webView == null) return;
        storageRestoreAttempted = false;
        webView.loadUrl(CREATE_URL);
    }

    private void loadLoginPage() {
        if (webView == null) return;
        storageRestoreAttempted = true;
        webView.loadUrl(LOGIN_URL);
    }

    private void resetFacebookSession() {
        storageRestoreAttempted = true;
        PortalSessionVault.clearProvider(this, "facebook");
        clearFacebookCookies();
        WebStorage.getInstance().deleteOrigin("https://www.facebook.com");
        if (webView != null) {
            webView.clearHistory();
            webView.clearFormData();
            webView.evaluateJavascript("try{localStorage.clear();sessionStorage.clear();}catch(e){}", ignored -> loadLoginPage());
        } else {
            loadLoginPage();
        }
    }

    private void clearFacebookCookies() {
        CookieManager manager = CookieManager.getInstance();
        String[] origins = { "https://www.facebook.com", "https://facebook.com", "https://m.facebook.com" };
        for (String origin : origins) {
            String cookies = manager.getCookie(origin);
            if (cookies == null) continue;
            for (String part : cookies.split(";")) {
                String name = part.split("=", 2)[0].trim();
                if (!name.isEmpty()) {
                    manager.setCookie(origin, name + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/");
                    manager.setCookie(origin, name + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=.facebook.com");
                }
            }
        }
        manager.flush();
    }

    private void openRecoveryInBrowser() {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(RECOVERY_URL)));
        } catch (RuntimeException error) {
            if (status != null) status.setText("No hay un navegador externo disponible para recuperar la cuenta.");
        }
    }

    private void captureSession(long delayMs) {
        mainHandler.postDelayed(() -> {
            if (webView == null || webView.getUrl() == null || !webView.getUrl().contains("facebook.com")) return;
            try { webView.evaluateJavascript(PortalSessionVault.snapshotScript("facebook", "LaujimMarketplaceBridge"), ignored -> { }); }
            catch (RuntimeException ignored) { }
        }, delayMs);
    }

    private void updateStatus(String current) {
        if (status == null) return;
        String lower = current.toLowerCase();
        if (lower.contains("/marketplace/create")) {
            status.setText("Sesión lista. Vuelve a Laujim y pulsa Publicar con el teléfono; el trabajo correrá en este mismo navegador.");
        } else if (lower.contains("recover") || lower.contains("identify")) {
            status.setText("Facebook está en recuperación. Termina el proceso en el navegador externo y luego vuelve a Iniciar sesión aquí.");
        } else if (lower.contains("login") || lower.contains("checkpoint") || lower.contains("two_factor")) {
            status.setText("Completa el inicio de sesión o 2FA. Si aparece un bucle, pulsa Reiniciar Facebook.");
        } else {
            status.setText("Facebook abierto. Al terminar de autenticarte, pulsa Abrir formulario.");
        }
    }

    static boolean hasActiveBrowser() {
        MarketplaceBrowserActivity activity = activeInstance;
        return activity != null && activity.webView != null;
    }

    static CompletableFuture<String> executeJob(JSONObject listing, boolean publish, String automationScript) {
        CompletableFuture<String> result = new CompletableFuture<>();
        MarketplaceBrowserActivity activity = activeInstance;
        if (activity == null || activity.webView == null) {
            result.completeExceptionally(new IllegalStateException("Abre Facebook desde Laujim y conserva ese navegador antes de publicar."));
            return result;
        }
        activity.mainHandler.post(() -> activity.startJob(listing, publish, automationScript, result));
        return result;
    }

    private void startJob(JSONObject listing, boolean publish, String automationScript, CompletableFuture<String> result) {
        synchronized (jobLock) {
            if (pendingJobResult != null && !pendingJobResult.isDone()) {
                result.completeExceptionally(new IllegalStateException("Ya hay una publicación de Marketplace en curso."));
                return;
            }
            pendingJobResult = result;
            currentListing = listing == null ? new JSONObject() : listing;
            jobEvaluationScheduled = false;
            while (stageEvents.length() > 0) stageEvents.remove(stageEvents.length() - 1);
            try {
                currentListing.put("__publish", publish);
                currentListing.put("__runner", automationScript == null ? "" : automationScript);
            } catch (Exception ignored) { }
        }
        if (status != null) status.setText("Preparando el formulario de Marketplace en la sesión autenticada…");
        storageRestoreAttempted = true;
        webView.loadUrl(CREATE_URL);
    }

    private void evaluatePendingJob() {
        JSONObject listing;
        CompletableFuture<String> pending;
        synchronized (jobLock) {
            pending = pendingJobResult;
            listing = currentListing;
        }
        if (webView == null || pending == null || pending.isDone() || listing == null) return;
        String runner = listing.optString("__runner", "");
        boolean publish = listing.optBoolean("__publish", true);
        JSONObject safeListing;
        try {
            safeListing = new JSONObject(listing.toString());
            safeListing.remove("__runner");
            safeListing.remove("__publish");
        } catch (Exception error) {
            safeListing = new JSONObject();
        }
        String expression = "(async()=>{try{" + runner
            + "if(!window.LaujimMarketplaceWorker||typeof window.LaujimMarketplaceWorker.run!=='function')throw new Error('Motor de Marketplace no disponible.');"
            + "const result=await window.LaujimMarketplaceWorker.run(" + safeListing + ",{publish:" + publish + "});"
            + "window.LaujimMarketplaceBridge.resolve(JSON.stringify(result));"
            + "}catch(e){window.LaujimMarketplaceBridge.resolve(JSON.stringify({state:'failed',stage:'runner',message:String(e&&e.message||e)}));}})();";
        try { webView.evaluateJavascript(expression, ignored -> { }); }
        catch (RuntimeException error) { completeJobException(error); }
    }

    private void deliverJobPhotos() {
        java.util.List<Uri> uris = new java.util.ArrayList<>();
        try {
            JSONObject listing;
            synchronized (jobLock) { listing = currentListing; }
            JSONArray urls = listing == null ? null : listing.optJSONArray("photoUrls");
            File directory = new File(getCacheDir(), "marketplace-photos");
            if (!directory.exists()) directory.mkdirs();
            if (urls != null) {
                for (int index = 0; index < Math.min(10, urls.length()); index += 1) {
                    String source = urls.optString(index, "");
                    if (source.isEmpty()) continue;
                    File target = new File(directory, "apartment_" + UUID.randomUUID() + ".jpg");
                    download(source, target);
                    uris.add(FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", target));
                }
            }
        } catch (Exception error) {
            addStage("photos_error", "No se pudieron preparar todas las fotos.", new JSONObject());
        }
        Uri[] selected = uris.toArray(new Uri[0]);
        mainHandler.post(() -> {
            ValueCallback<Uri[]> callback = pendingFileCallback;
            pendingFileCallback = null;
            if (callback != null) callback.onReceiveValue(selected);
        });
    }

    private boolean hasAutomatedPhotoSelection() {
        synchronized (jobLock) {
            JSONArray urls = currentListing == null ? null : currentListing.optJSONArray("photoUrls");
            return urls != null && urls.length() > 0;
        }
    }

    private void openSystemPhotoPicker() {
        try {
            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("image/*")
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(picker, PHOTO_PICKER_REQUEST);
        } catch (RuntimeException error) {
            ValueCallback<Uri[]> callback = pendingFileCallback;
            pendingFileCallback = null;
            if (callback != null) callback.onReceiveValue(null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PHOTO_PICKER_REQUEST) return;
        Uri[] selected = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                selected = new Uri[count];
                for (int index = 0; index < count; index += 1) selected[index] = data.getClipData().getItemAt(index).getUri();
            } else if (data.getData() != null) {
                selected = new Uri[] { data.getData() };
            }
        }
        ValueCallback<Uri[]> callback = pendingFileCallback;
        pendingFileCallback = null;
        if (callback != null) callback.onReceiveValue(selected);
    }

    private void download(String source, File target) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(40_000);
        connection.setRequestProperty("Accept", "image/*");
        int response = connection.getResponseCode();
        if (response < 200 || response >= 300) throw new IllegalStateException("Foto HTTP " + response);
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        } finally { connection.disconnect(); }
    }

    private void addStage(String stage, String message, JSONObject details) {
        synchronized (jobLock) {
            try {
                stageEvents.put(new JSONObject()
                    .put("stage", String.valueOf(stage == null ? "marketplace" : stage).substring(0, Math.min(80, String.valueOf(stage == null ? "marketplace" : stage).length())))
                    .put("message", String.valueOf(message == null ? "Evento de Marketplace." : message).substring(0, Math.min(500, String.valueOf(message == null ? "Evento de Marketplace." : message).length())))
                    .put("eventAt", new java.util.Date().toInstant().toString())
                    .put("details", details == null ? JSONObject.NULL : details));
            } catch (Exception ignored) { }
        }
    }

    private void completeJobException(Exception error) {
        CompletableFuture<String> pending;
        synchronized (jobLock) {
            pending = pendingJobResult;
            pendingJobResult = null;
            currentListing = null;
        }
        if (pending != null && !pending.isDone()) pending.completeExceptionally(error);
    }

    private void returnToLaujim() {
        captureSession(0L);
        PortalSessionVault.flushCookies();
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else returnToLaujim();
    }

    @Override
    protected void onDestroy() {
        captureSession(0L);
        if (activeInstance == this) activeInstance = null;
        completeJobException(new IllegalStateException("El navegador de Marketplace se cerró."));
        executor.shutdownNow();
        PortalSessionVault.flushCookies();
        if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(new Uri[0]);
        pendingFileCallback = null;
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class MarketplaceBridge {
        @JavascriptInterface
        public void requestPhotos() {
            mainHandler.post(() -> {
                if (webView == null) return;
                webView.evaluateJavascript("(function(){const i=document.querySelector('input[type=file][accept*=image],input[type=file]');if(i)i.click();})();", ignored -> { });
            });
        }

        @JavascriptInterface
        public void stage(String stage, String message, String detailsJson) {
            JSONObject details;
            try { details = new JSONObject(detailsJson == null || detailsJson.isEmpty() ? "{}" : detailsJson); }
            catch (Exception ignored) { details = new JSONObject(); }
            addStage(stage, message, details);
            if (status != null) mainHandler.post(() -> status.setText(message == null || message.isEmpty() ? "Marketplace en ejecución…" : message));
        }

        @JavascriptInterface
        public void persistSession(String provider, String value) {
            if (value != null && !value.isEmpty()) PortalSessionVault.saveState(MarketplaceBrowserActivity.this, "facebook", value);
            PortalSessionVault.flushCookies();
        }

        @JavascriptInterface
        public void resolve(String value) {
            CompletableFuture<String> pending;
            JSONObject outcome;
            try { outcome = new JSONObject(value == null || value.isEmpty() ? "{}" : value); }
            catch (Exception ignored) {
                outcome = new JSONObject();
                try { outcome.put("state", "failed").put("message", "Facebook devolvió una respuesta local inválida."); }
                catch (Exception ignoredAgain) { }
            }
            synchronized (jobLock) {
                try { outcome.put("events", new JSONArray(stageEvents.toString())); } catch (Exception ignored) { }
                pending = pendingJobResult;
                pendingJobResult = null;
                currentListing = null;
                jobEvaluationScheduled = false;
            }
            captureSession(0L);
            if (pending != null && !pending.isDone()) pending.complete(outcome.toString());
        }
    }
}
