package com.laujim.aptmanager;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputType;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
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
    static final String CREATE_URL = "https://m.facebook.com/marketplace/create/";
    private static final String MOBILE_COMPOSER_URL = "https://m.facebook.com/marketplace/selling/item/?listing_id";
    private static final String LOGIN_URL = "https://limited.facebook.com/login/";
    private static final String FACEBOOK_HOME_URL = "https://limited.facebook.com/";
    private static final int PHOTO_PICKER_REQUEST = 31782;

    private static volatile MarketplaceBrowserActivity activeInstance;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object jobLock = new Object();
    private final JSONArray stageEvents = new JSONArray();
    private WebView webView;
    private TextView status;
    private EditText urlField;
    private CompletableFuture<String> pendingJobResult;
    private JSONObject currentListing;
    private ValueCallback<Uri[]> pendingFileCallback;
    private final java.util.List<Uri> automatedPhotoUris = new java.util.ArrayList<>();
    private int automatedPhotoIndex;
    private boolean photoSaveGesturePending;
    private boolean jobEvaluationScheduled;
    private boolean storageRestoreAttempted;
    private boolean limitedLoginFallbackAttempted;

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

        LinearLayout addressRow = new LinearLayout(this);
        addressRow.setPadding(16, 0, 16, 4);
        urlField = new EditText(this);
        urlField.setSingleLine(true);
        urlField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        urlField.setText(CREATE_URL);
        urlField.setSelectAllOnFocus(false);
        urlField.setHint("URL de Facebook");
        addressRow.addView(urlField, new LinearLayout.LayoutParams(0, -2, 1));
        Button go = new Button(this);
        go.setText("Ir");
        go.setOnClickListener(view -> loadManualFacebookUrl());
        addressRow.addView(go, new LinearLayout.LayoutParams(-2, -2));
        urlField.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_GO
                || actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                loadManualFacebookUrl();
                return true;
            }
            return false;
        });
        root.addView(addressRow, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout actions = new LinearLayout(this);
        actions.setPadding(16, 0, 16, 8);
        Button form = new Button(this);
        form.setText("Abrir formulario");
        form.setOnClickListener(view -> loadCreatePage());
        actions.addView(form, new LinearLayout.LayoutParams(0, -2, 1));
        Button login = new Button(this);
        login.setText("Login");
        login.setOnClickListener(view -> loadManualFacebookUrl(LOGIN_URL));
        actions.addView(login, new LinearLayout.LayoutParams(0, -2, 1));
        Button close = new Button(this);
        close.setText("Volver a Laujim");
        close.setOnClickListener(view -> returnToLaujim());
        actions.addView(close, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(actions, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout browserActions = new LinearLayout(this);
        browserActions.setPadding(16, 0, 16, 4);
        Button back = new Button(this);
        back.setText("Atras");
        back.setOnClickListener(view -> {
            if (webView != null && webView.canGoBack()) webView.goBack();
            else if (status != null) status.setText("No hay una pagina anterior en Facebook.");
        });
        browserActions.addView(back, new LinearLayout.LayoutParams(0, -2, 1));
        Button forward = new Button(this);
        forward.setText("Adelante");
        forward.setOnClickListener(view -> {
            if (webView != null && webView.canGoForward()) webView.goForward();
            else if (status != null) status.setText("No hay una pagina siguiente en Facebook.");
        });
        browserActions.addView(forward, new LinearLayout.LayoutParams(0, -2, 1));
        Button reload = new Button(this);
        reload.setText("Recargar");
        reload.setOnClickListener(view -> {
            if (webView != null) webView.reload();
        });
        browserActions.addView(reload, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(browserActions, new LinearLayout.LayoutParams(-1, -2));

        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        loadLoginPage();
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
                addStage("photo_chooser_requested", "Android recibió la solicitud del selector de fotos.", null);
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
            public void onPageStarted(WebView page, String url, Bitmap favicon) {
                updateAddress(url);
                if (status != null) status.setText("Cargando Facebook...\n" + safeUrl(url));
            }

            @Override
            public void onPageFinished(WebView page, String url) {
                updateAddress(url);
                PortalSessionVault.flushCookies();
                String current = url == null ? "" : url;
                if (shouldUseLimitedLogin(current)) {
                    limitedLoginFallbackAttempted = true;
                    page.loadUrl(LOGIN_URL);
                    return;
                }
                if (!storageRestoreAttempted && current.contains("facebook.com")) {
                    storageRestoreAttempted = true;
                    String state = PortalSessionVault.loadState(MarketplaceBrowserActivity.this, "facebook");
                    if (!state.isEmpty()) {
                        page.evaluateJavascript(PortalSessionVault.restoreScript(state), ignored ->
                            mainHandler.postDelayed(() -> {
                                if (webView != null) webView.loadUrl(CREATE_URL);
                            }, 250L));
                        return;
                    }
                }
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

            @Override
            public void onReceivedError(WebView page, WebResourceRequest request, WebResourceError error) {
                if (request == null || request.isForMainFrame()) {
                    String message = error == null ? "Error desconocido" : String.valueOf(error.getDescription());
                    if (status != null) status.setText("Facebook no pudo cargar la pagina.\n" + message);
                }
            }

            @Override
            public void onReceivedHttpError(WebView page, WebResourceRequest request, WebResourceResponse response) {
                if (request != null && request.isForMainFrame() && response != null && status != null) {
                    status.setText("Facebook respondio HTTP " + response.getStatusCode() + ".\n" + safeUrl(request.getUrl().toString()));
                }
            }
        });
    }

    private void loadCreatePage() {
        if (webView == null) return;
        storageRestoreAttempted = false;
        limitedLoginFallbackAttempted = false;
        updateAddress(CREATE_URL);
        webView.loadUrl(CREATE_URL);
    }

    private void loadLoginPage() {
        if (webView == null) return;
        storageRestoreAttempted = true;
        limitedLoginFallbackAttempted = true;
        updateAddress(LOGIN_URL);
        webView.loadUrl(LOGIN_URL);
    }

    private void loadManualFacebookUrl() {
        if (urlField == null) return;
        loadManualFacebookUrl(urlField.getText() == null ? "" : urlField.getText().toString());
    }

    private void loadManualFacebookUrl(String rawUrl) {
        if (webView == null) return;
        String value = rawUrl == null ? "" : rawUrl.trim();
        if (value.isEmpty()) value = FACEBOOK_HOME_URL;
        if (!value.contains("://")) value = "https://" + value;
        if (!isWebUrl(value)) {
            if (status != null) status.setText("La URL debe comenzar por http:// o https://.");
            return;
        }
        if (value.equals(LOGIN_URL)) limitedLoginFallbackAttempted = true;
        storageRestoreAttempted = true;
        updateAddress(value);
        webView.loadUrl(value);
    }

    private boolean shouldUseLimitedLogin(String value) {
        if (limitedLoginFallbackAttempted || value == null || value.isEmpty()) return false;
        try {
            Uri uri = Uri.parse(value);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
            String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase();
            return ("facebook.com".equals(host) || host.endsWith(".facebook.com"))
                && !"limited.facebook.com".equals(host)
                && (path.contains("/login") || path.contains("/checkpoint") || path.contains("/two_step_verification"));
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private boolean isWebUrl(String value) {
        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
            return ("https".equals(scheme) || "http".equals(scheme)) && !host.isEmpty();
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private void updateAddress(String url) {
        if (urlField == null || url == null || url.isEmpty()) return;
        urlField.setText(url);
        urlField.setSelection(urlField.length());
    }

    private String safeUrl(String url) {
        if (url == null || url.isEmpty()) return "URL desconocida";
        return url.length() > 180 ? url.substring(0, 180) + "..." : url;
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
        if (lower.contains("/marketplace/create") || lower.contains("/marketplace/selling/item")) {
            status.setText("Sesión lista. Vuelve a Laujim y pulsa Publicar con el teléfono; el trabajo correrá en este mismo navegador.");
        } else if (lower.contains("login") || lower.contains("checkpoint") || lower.contains("two_factor")) {
            status.setText("Completa el inicio de sesión, 2FA o verificación directamente en Facebook.");
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
            automatedPhotoUris.clear();
            automatedPhotoIndex = 0;
            photoSaveGesturePending = false;
            jobEvaluationScheduled = false;
            while (stageEvents.length() > 0) stageEvents.remove(stageEvents.length() - 1);
            try {
                currentListing.put("__publish", publish);
                currentListing.put("__runner", automationScript == null ? "" : automationScript);
            } catch (Exception ignored) { }
        }
        if (status != null) status.setText("Preparando el formulario de Marketplace en la sesión autenticada…");
        // A file chooser cannot be opened by a paused WebView. The user starts
        // the job from Laujim, so this activity may be behind MainActivity even
        // though its authenticated session is still alive. Bring this exact
        // browser instance to the foreground before navigating.
        Runnable navigateToComposer = () -> {
            synchronized (jobLock) {
                if (pendingJobResult == null || pendingJobResult.isDone()) return;
            }
            storageRestoreAttempted = true;
            String current = webView.getUrl() == null ? "" : webView.getUrl().toLowerCase();
            if (current.contains("/marketplace/selling/item")) {
                jobEvaluationScheduled = true;
                mainHandler.postDelayed(MarketplaceBrowserActivity.this::evaluatePendingJob, 3_500L);
            } else {
                webView.loadUrl(MOBILE_COMPOSER_URL);
            }
        };
        try {
            startActivity(new Intent(this, MarketplaceBrowserActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
            addStage("browser_foreground", "Facebook volviÃ³ al frente para permitir el selector de fotos.", null);
            mainHandler.postDelayed(navigateToComposer, 850L);
        } catch (RuntimeException error) {
            navigateToComposer.run();
        }
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
        JSONObject listing;
        synchronized (jobLock) { listing = currentListing; }
        JSONArray urls = listing == null ? null : listing.optJSONArray("photoUrls");
        java.util.List<Uri> prepared = new java.util.ArrayList<>();
        synchronized (jobLock) {
            prepared.addAll(automatedPhotoUris);
        }
        if (prepared.isEmpty() && urls != null) {
            File directory = new File(getCacheDir(), "marketplace-photos");
            if (!directory.exists()) directory.mkdirs();
            for (int index = 0; index < Math.min(10, urls.length()); index += 1) {
                String source = urls.optString(index, "");
                if (source.isEmpty()) continue;
                try {
                    File target = MarketplacePhotoUtils.downloadAndPrepare(
                        source, directory, "apartment_" + UUID.randomUUID(), 15_000, 40_000);
                    prepared.add(FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", target));
                    addStage("photo_prepared", "Foto preparada automáticamente.",
                        photoDetails(index + 1, target.length(), null));
                } catch (Exception error) {
                    addStage("photo_failed", "No se pudo preparar una foto automáticamente.",
                        photoDetails(index + 1, 0, String.valueOf(error.getMessage())));
                }
            }
            synchronized (jobLock) {
                automatedPhotoUris.clear();
                automatedPhotoUris.addAll(prepared);
            }
        }
        Uri selectedUri = null;
        synchronized (jobLock) {
            if (automatedPhotoIndex < automatedPhotoUris.size()) {
                selectedUri = automatedPhotoUris.get(automatedPhotoIndex);
                automatedPhotoIndex += 1;
            }
        }
        Uri[] selected = selectedUri == null ? new Uri[0] : new Uri[] { selectedUri };
        final Uri[] callbackValue = selected;
        mainHandler.post(() -> {
            ValueCallback<Uri[]> callback = pendingFileCallback;
            pendingFileCallback = null;
            if (callback != null) callback.onReceiveValue(callbackValue);
            if (callbackValue.length > 0) {
                addStage("photo_delivered", "Facebook recibió una foto preparada; esperando su vista previa.", null);
            } else if (urls != null && urls.length() > 0) {
                addStage("photos_error", "No se pudo preparar la siguiente foto del apartamento.",
                    photoDetails(Math.min(10, urls.length()), 0, "sin fotos preparadas"));
            }
        });
    }

    private JSONObject photoDetails(int index, long bytes, String error) {
        JSONObject details = new JSONObject();
        try {
            details.put("index", index);
            if (bytes > 0) details.put("bytes", bytes);
            if (error != null) details.put("error", error);
        } catch (Exception ignored) { }
        return details;
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

    /**
     * Facebook Lite shows an HTML menu before it invokes the hidden file input.
     * A JavaScript click on that menu is not considered a user gesture by
     * Android WebView, so onShowFileChooser is never called. Resolve the
     * visible menu element in CSS pixels and send one native touch sequence to
     * it; the existing WebChromeClient then delivers the prepared files.
     */
    private void requestPhotoUploadGesture() {
        requestPhotoUploadGesture(0);
    }

    private void requestPhotoUploadGesture(int attempt) {
        if (webView == null) return;
        String script = "(function(){"
            + "var all=Array.from(document.querySelectorAll('[tabindex],button,[role=button],div,span'));"
            + "var norm=function(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim()};"
            + "var find=function(words){return all.filter(function(e){var t=norm(e.innerText||e.textContent);"
            + "var r=e.getBoundingClientRect(),s=getComputedStyle(e);"
            + "return words.some(function(w){return t===w})&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';"
            + "}).sort(function(a,b){return (a.innerText||a.textContent||'').length-(b.innerText||b.textContent||'').length})[0]};"
            + "var upload=find(['subir foto','upload photo','choose photo']);"
            + "var add=find(['anadir fotos','agregar fotos','add photos']);"
            + "var e=upload||add;if(!e)return 'missing';var r=e.getBoundingClientRect();"
            + "return (upload?'upload':'add')+'|'+(r.left+r.width/2)+'|'+(r.top+r.height/2);"
            + "})()";
        webView.evaluateJavascript(script, value -> {
            String result = value == null ? "" : value.trim();
            if (result.length() >= 2 && result.startsWith("\"") && result.endsWith("\"")) {
                result = result.substring(1, result.length() - 1);
            }
            result = result.replace("\\\"", "\"");
            if (result.isEmpty() || "missing".equals(result)) {
                if (attempt < 20) mainHandler.postDelayed(() -> requestPhotoUploadGesture(attempt + 1), 250L);
                return;
            }
            String[] parts = result.split("\\|");
            if (parts.length != 3) return;
            try {
                float x = Float.parseFloat(parts[1]) * webView.getScale();
                float y = Float.parseFloat(parts[2]) * webView.getScale();
                float maxX = Math.max(1, webView.getWidth() - 2);
                float maxY = Math.max(1, webView.getHeight() - 2);
                x = Math.max(1, Math.min(maxX, x));
                y = Math.max(1, Math.min(maxY, y));
                if ("add".equals(parts[0])) {
                    addStage("photo_native_gesture", "Abriendo el menú de fotos con un gesto nativo.", null);
                    dispatchWebTouch(x, y);
                    mainHandler.postDelayed(() -> requestPhotoUploadGesture(attempt + 1), 450L);
                } else {
                    addStage("photo_upload_gesture", "Seleccionando Subir foto con un gesto nativo.", null);
                    dispatchWebTouch(x, y);
                }
            } catch (RuntimeException ignored) { }
        });
    }

    private void dispatchWebTouch(float x, float y) {
        if (webView == null) return;
        long now = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = MotionEvent.obtain(now, now + 80L, MotionEvent.ACTION_UP, x, y, 0);
        try {
            down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            webView.requestFocusFromTouch();
            webView.dispatchTouchEvent(down);
            webView.dispatchTouchEvent(up);
        } finally {
            down.recycle();
            up.recycle();
        }
    }

    /** Facebook Lite opens a trusted preview page after each selected image. */
    private void requestPhotoPreviewSave() {
        requestPhotoPreviewSave(0);
    }

    private void requestPhotoPreviewSave(int attempt) {
        if (webView == null) return;
        if (photoSaveGesturePending && attempt == 0) return;
        String script = "(function(){"
            + "var all=Array.from(document.querySelectorAll('[role=button],[tabindex],button,a,div,span'));"
            + "var norm=function(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim()};"
            + "var matches=all.filter(function(e){var t=norm(e.innerText||e.textContent||e.getAttribute('aria-label'));"
            + "var r=e.getBoundingClientRect(),s=getComputedStyle(e);"
            + "return t==='guardar'&&r.width>20&&r.height>20&&s.display!=='none'&&s.visibility!=='hidden';"
            + "}).sort(function(a,b){var ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();"
            + "return (br.width*br.height)-(ar.width*ar.height)||br.top-ar.top});"
            + "var e=matches.length?matches[0]:null;if(!e)return 'missing';var r=e.getBoundingClientRect();"
            + "return (r.left+r.width/2)+'|'+(r.top+r.height/2);"
            + "})()";
        webView.evaluateJavascript(script, value -> {
            String result = value == null ? "" : value.trim();
            if (result.length() >= 2 && result.startsWith("\"") && result.endsWith("\"")) {
                result = result.substring(1, result.length() - 1);
            }
            result = result.replace("\\\"", "\"");
            if (result.isEmpty() || "missing".equals(result)) {
                if (attempt < 20) mainHandler.postDelayed(() -> requestPhotoPreviewSave(attempt + 1), 250L);
                return;
            }
            String[] parts = result.split("\\|");
            if (parts.length != 2) return;
            try {
                float x = Float.parseFloat(parts[0]) * webView.getScale();
                float y = Float.parseFloat(parts[1]) * webView.getScale();
                float maxX = Math.max(1, webView.getWidth() - 2);
                float maxY = Math.max(1, webView.getHeight() - 2);
                x = Math.max(1, Math.min(maxX, x));
                y = Math.max(1, Math.min(maxY, y));
                photoSaveGesturePending = true;
                addStage("photo_preview_save_gesture", "Guardando la vista previa de Facebook con un gesto nativo.", null);
                dispatchWebTouch(x, y);
                mainHandler.postDelayed(() -> photoSaveGesturePending = false, 1_500L);
            } catch (RuntimeException ignored) { }
        });
    }

    /** Facebook Lite also treats the housing category menu as a user-only control. */
    private void requestCategoryGesture() {
        if (webView == null) return;
        String script = "(function(){"
            + "var all=Array.from(document.querySelectorAll('[role=button],[role=option],[role=menuitem],[tabindex],button,a,div,span'));"
            + "var norm=function(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim()};"
            + "var matches=all.filter(function(e){var t=norm(e.innerText||e.textContent||e.getAttribute('aria-label'));"
            + "var r=e.getBoundingClientRect(),s=getComputedStyle(e);"
            + "return t==='alquileres'&&r.top>80&&r.width>20&&r.height>20&&s.display!=='none'&&s.visibility!=='hidden';"
            + "}).sort(function(a,b){return (b.getBoundingClientRect().width*b.getBoundingClientRect().height)-(a.getBoundingClientRect().width*a.getBoundingClientRect().height)});"
            + "var e=matches.length?matches[0]:null;if(!e)return 'missing';var r=e.getBoundingClientRect();return (r.left+r.width/2)+'|'+(r.top+r.height/2);"
            + "})()";
        webView.evaluateJavascript(script, value -> {
            String result = value == null ? "" : value.trim();
            if (result.length() >= 2 && result.startsWith("\"") && result.endsWith("\"")) {
                result = result.substring(1, result.length() - 1);
            }
            result = result.replace("\\\"", "\"");
            String[] parts = result.split("\\|");
            if (parts.length != 2) return;
            try {
                float x = Float.parseFloat(parts[0]) * webView.getScale();
                float y = Float.parseFloat(parts[1]) * webView.getScale();
                x = Math.max(1, Math.min(Math.max(1, webView.getWidth() - 2), x));
                y = Math.max(1, Math.min(Math.max(1, webView.getHeight() - 2), y));
                addStage("mobile_category_gesture", "Seleccionando Alquileres con un gesto nativo.", null);
                dispatchWebTouch(x, y);
            } catch (RuntimeException ignored) { }
        });
    }

    /**
     * Facebook Lite also requires a trusted touch for the final Publicar
     * action. A synthetic DOM click can leave the completed form unchanged.
     */
    private void requestPublishGesture() {
        requestPublishGesture(0);
    }

    private void requestPublishGesture(int attempt) {
        if (webView == null) return;
        String script = "(function(){"
            + "var all=Array.from(document.querySelectorAll('[role=button],[tabindex],button,a,div,span'));"
            + "var norm=function(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim()};"
            + "var matches=all.filter(function(e){var t=norm(e.innerText||e.textContent||e.getAttribute('aria-label'));"
            + "var r=e.getBoundingClientRect(),s=getComputedStyle(e);"
            + "return t==='publicar'&&r.width>20&&r.height>20&&s.display!=='none'&&s.visibility!=='hidden'&&r.top>80;"
            + "}).sort(function(a,b){return a.getBoundingClientRect().top-b.getBoundingClientRect().top});"
            + "var actionable=matches.filter(function(e){return e.hasAttribute('data-action-id')});"
            + "if(actionable.length)matches=actionable;"
            + "matches.sort(function(a,b){var ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();"
            + "return (br.width*br.height)-(ar.width*ar.height)||br.top-ar.top});"
            + "var e=matches.length?matches[0]:null;if(!e)return 'missing';"
            + "var r=e.getBoundingClientRect();return (r.left+r.width/2)+'|'+(r.top+r.height/2);"
            + "})()";
        webView.evaluateJavascript(script, value -> {
            String result = value == null ? "" : value.trim();
            if (result.length() >= 2 && result.startsWith("\"") && result.endsWith("\"")) {
                result = result.substring(1, result.length() - 1);
            }
            result = result.replace("\\\"", "\"");
            if (result.isEmpty() || "missing".equals(result)) {
                if (attempt < 20) mainHandler.postDelayed(() -> requestPublishGesture(attempt + 1), 250L);
                return;
            }
            String[] parts = result.split("\\|");
            if (parts.length != 2) return;
            try {
                float x = Float.parseFloat(parts[0]) * webView.getScale();
                float y = Float.parseFloat(parts[1]) * webView.getScale();
                float maxX = Math.max(1, webView.getWidth() - 2);
                float maxY = Math.max(1, webView.getHeight() - 2);
                x = Math.max(1, Math.min(maxX, x));
                y = Math.max(1, Math.min(maxY, y));
                addStage("publish_native_gesture", "Enviando Publicar con un gesto nativo.", null);
                dispatchWebTouch(x, y);
                monitorNativePublishResult(0);
            } catch (RuntimeException ignored) { }
        });
    }

    /**
     * The trusted touch can navigate away before the JavaScript worker gets
     * to call resolve(). Observe the new page from Java so a successful
     * Marketplace publication cannot leave the local job stuck in processing.
     */
    private void monitorNativePublishResult(int attempt) {
        if (webView == null) return;
        String script = "(function(){return JSON.stringify({url:location.href,body:(document.body&&document.body.innerText||'').slice(0,5000)});})()";
        webView.evaluateJavascript(script, value -> {
            String result = value == null ? "" : value.trim();
            if (result.length() >= 2 && result.startsWith("\"") && result.endsWith("\"")) {
                result = result.substring(1, result.length() - 1);
            }
            result = result.replace("\\\"", "\"");
            try {
                JSONObject page = new JSONObject(result);
                String url = page.optString("url", "").toLowerCase();
                String body = page.optString("body", "").toLowerCase();
                boolean published = url.contains("/marketplace/item/")
                    || body.contains("se ha publicado correctamente")
                    || body.contains("publicado correctamente en marketplace");
                if (published) {
                    JSONObject outcome = new JSONObject()
                        .put("state", "published")
                        .put("stage", "published")
                        .put("message", "Facebook confirmó la publicación.")
                        .put("listingUrl", url.contains("/marketplace/item/") ? url : "");
                    addStage("published", "Facebook confirmó la publicación desde el navegador local.", null);
                    new MarketplaceBridge().resolve(outcome.toString());
                    return;
                }
            } catch (Exception ignored) { }
            if (attempt < 120) {
                mainHandler.postDelayed(() -> monitorNativePublishResult(attempt + 1), 1000L);
            }
        });
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
        if (callback == null) return;
        if (selected == null || selected.length == 0) {
            callback.onReceiveValue(selected);
            return;
        }
        Uri[] picked = selected;
        executor.execute(() -> {
            java.util.List<Uri> prepared = new java.util.ArrayList<>();
            File directory = new File(getCacheDir(), "marketplace-photos");
            if (!directory.exists()) directory.mkdirs();
            for (int index = 0; index < Math.min(10, picked.length); index += 1) {
                try {
                    File target = MarketplacePhotoUtils.prepareUri(
                        getContentResolver(), picked[index], directory,
                        "manual_" + UUID.randomUUID());
                    prepared.add(FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", target));
                    addStage("photo_prepared", "Foto manual preparada automáticamente.",
                        photoDetails(index + 1, target.length(), null));
                } catch (Exception error) {
                    addStage("photo_failed", "No se pudo preparar una foto manual.",
                        photoDetails(index + 1, 0, String.valueOf(error.getMessage())));
                }
            }
            Uri[] result = prepared.toArray(new Uri[0]);
            mainHandler.post(() -> callback.onReceiveValue(result));
        });
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
                requestPhotoUploadGesture();
            });
        }

        @JavascriptInterface
        public void requestPhotoPreviewSave() {
            mainHandler.post(() -> {
                if (webView == null) return;
                MarketplaceBrowserActivity.this.requestPhotoPreviewSave();
            });
        }

        @JavascriptInterface
        public void requestCategory() {
            mainHandler.post(() -> {
                if (webView == null) return;
                requestCategoryGesture();
            });
        }

        @JavascriptInterface
        public void requestPublish() {
            mainHandler.post(() -> {
                if (webView == null) return;
                requestPublishGesture();
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
