package com.laujim.aptmanager;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.os.SystemClock;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Visible local browser used for portal login and human verification. The
 * worker prefers this exact WebView and also keeps an encrypted snapshot of
 * per-origin sessionStorage so Android can recover after reclaiming it.
 */
public class PortalBrowserActivity extends Activity {
    public static final String EXTRA_PROVIDER = "provider";

    private static volatile PortalBrowserActivity activeInstance;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object scraperLock = new Object();
    private WebView webView;
    private TextView status;
    private String provider = "air-e";
    private String currentUrl = "";
    private String nativeAuthorization = "";
    private String nativeAirContract = "";
    // A paused Activity keeps its attached WebView and real browser profile.
    // Reusing it lets portal security widgets finish normally without showing
    // another window during an hourly run.
    private boolean storageRestoreAttempted;
    private int navigationGeneration;
    private CompletableFuture<Boolean> pageReady = new CompletableFuture<>();
    private CompletableFuture<String> pendingScraperResult;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        activeInstance = this;
        provider = normalize(getIntent().getStringExtra(EXTRA_PROVIDER));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(android.graphics.Color.WHITE);

        TextView title = new TextView(this);
        title.setText("Laujim · Portales");
        title.setTextColor(android.graphics.Color.rgb(20, 30, 45));
        title.setTextSize(18);
        title.setPadding(24, 20, 24, 8);
        root.addView(title, new LinearLayout.LayoutParams(-1, -2));

        status = new TextView(this);
        status.setText("Inicia sesión o completa la verificación. La sesión se conserva cifrada solo en este dispositivo.");
        status.setTextColor(android.graphics.Color.DKGRAY);
        status.setTextSize(13);
        status.setPadding(24, 0, 24, 12);
        root.addView(status, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout actions = new LinearLayout(this);
        actions.setPadding(16, 0, 16, 8);
        Button clear = new Button(this);
        clear.setText("Borrar cookies del portal");
        clear.setOnClickListener(view -> clearPortalData());
        actions.addView(clear, new LinearLayout.LayoutParams(0, -2, 1));
        Button close = new Button(this);
        close.setText("Volver a Laujim");
        close.setOnClickListener(view -> returnToLaujim());
        actions.addView(close, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(actions, new LinearLayout.LayoutParams(-1, -2));

        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        beginLoad(provider);
    }

    @Override
    protected void onStart() {
        super.onStart();
        activeInstance = this;
    }

    @Override
    protected void onResume() {
        super.onResume();
        activeInstance = this;
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            try { webView.evaluateJavascript(PortalSessionVault.snapshotScript(provider, "LaujimAndroidBridge"), ignored -> { }); }
            catch (RuntimeException ignored) { }
        }
        PortalSessionVault.saveCookieSnapshot(this, provider);
        PortalSessionVault.flushCookies();
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String nextProvider = normalize(intent == null ? null : intent.getStringExtra(EXTRA_PROVIDER));
        if (!nextProvider.equals(provider)) {
            persistThen(() -> beginLoad(nextProvider));
        } else if (status != null) {
            status.setText("Sesión conservada. El worker usará este mismo navegador para " + providerLabel(provider) + ".");
        }
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);
        view.addJavascriptInterface(new PortalBridge(), "LaujimAndroidBridge");
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView page, String url, Bitmap favicon) {
                currentUrl = url == null ? "" : url;
                installAuthorizationHook(page);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView page, WebResourceRequest request) {
                captureAuthorization(
                    request == null || request.getUrl() == null ? null : request.getUrl().toString(),
                    request == null ? null : request.getRequestHeaders()
                );
                return super.shouldInterceptRequest(page, request);
            }

            @Override
            public void onPageFinished(WebView page, String url) {
                currentUrl = url == null ? "" : url;
                PortalSessionVault.flushCookies();
                installAuthorizationHook(page);
                final int generation = navigationGeneration;
                if (!storageRestoreAttempted && isProviderUrl(currentUrl, provider)) {
                    storageRestoreAttempted = true;
                    String state = PortalSessionVault.loadState(PortalBrowserActivity.this, provider);
                    if (!state.isEmpty()) {
                        page.evaluateJavascript(PortalSessionVault.restoreScript(state), ignored ->
                            mainHandler.postDelayed(() -> {
                                if (webView != null && generation == navigationGeneration) webView.loadUrl(portalWorkUrl(provider));
                            }, 250L));
                        return;
                    }
                }
                storageRestoreAttempted = true;
                captureSessionLater(generation, 800L);
                captureSessionLater(generation, 3_000L);
                captureSessionLater(generation, 8_000L);
                mainHandler.postDelayed(() -> {
                    if (generation != navigationGeneration) return;
                    CompletableFuture<Boolean> ready;
                    synchronized (scraperLock) { ready = pageReady; }
                    if (ready != null && !ready.isDone()) ready.complete(true);
                }, 1_200L);
                if (status != null) {
                    status.setText("Página cargada. Completa cualquier verificación aquí. Sesión local: " + currentUrl);
                }
            }
        });
    }

    private void beginLoad(String nextProvider) {
        if (webView == null) return;
        String previousProvider = provider;
        provider = normalize(nextProvider);
        PortalSessionVault.activateCookieSession(this, previousProvider, provider);
        navigationGeneration += 1;
        storageRestoreAttempted = false;
        nativeAuthorization = PortalSessionVault.loadAuthorization(this, provider);
        nativeAirContract = "";
        synchronized (scraperLock) { pageReady = new CompletableFuture<>(); }
        currentUrl = "";
        PortalSessionVault.flushCookies();
        if (status != null) status.setText("Cargando " + providerLabel(provider) + " en el navegador compartido…");
        webView.loadUrl(portalWorkUrl(provider));
    }

    private void persistThen(Runnable action) {
        if (webView == null || currentUrl.isEmpty()) {
            action.run();
            return;
        }
        try {
            webView.evaluateJavascript(PortalSessionVault.snapshotScript(provider, "LaujimAndroidBridge"), ignored -> action.run());
        } catch (RuntimeException ignored) {
            action.run();
        }
    }

    private void captureSessionLater(int generation, long delayMs) {
        mainHandler.postDelayed(() -> {
            if (webView == null || generation != navigationGeneration || !isProviderUrl(currentUrl, provider)) return;
            try { webView.evaluateJavascript(PortalSessionVault.snapshotScript(provider, "LaujimAndroidBridge"), ignored -> { }); }
            catch (RuntimeException ignored) { }
        }, delayMs);
    }

    private void installAuthorizationHook(WebView page) {
        if (page == null) return;
        mainHandler.post(() -> {
            try { page.evaluateJavascript(PortalSessionVault.authorizationCaptureScript("LaujimAndroidBridge"), ignored -> { }); }
            catch (RuntimeException ignored) { }
        });
    }

    private void captureAuthorization(String url, Map<String, String> headers) {
        if (url == null || !isProviderUrl(url, provider)) return;
        if (url.toLowerCase().contains("portal.air-e.com")) {
            java.util.regex.Matcher contract = java.util.regex.Pattern
                .compile("(?:[?&]cd_contrato=)([0-9a-f-]{36})", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(url);
            if (contract.find()) nativeAirContract = contract.group(1);
        }
        if (headers == null) return;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null && "authorization".equalsIgnoreCase(entry.getKey())
                && entry.getValue() != null && !entry.getValue().trim().isEmpty()) {
                nativeAuthorization = entry.getValue().trim();
                PortalSessionVault.saveAuthorization(this, provider, nativeAuthorization);
                return;
            }
        }
    }

    private void clearPortalData() {
        synchronized (scraperLock) {
            completePendingExceptionLocked(new IllegalStateException("La sesión del portal fue borrada."));
            pageReady = new CompletableFuture<>();
        }
        PortalSessionVault.clear(this);
        CookieManager.getInstance().removeAllCookies(value -> {
            PortalSessionVault.flushCookies();
            WebStorage.getInstance().deleteAllData();
            if (webView != null) {
                webView.clearCache(true);
                webView.clearHistory();
            }
            if (status != null) status.setText("Cookies y sesión cifrada borradas. Cargando el portal nuevamente…");
            beginLoad(provider);
        });
    }

    private void returnToLaujim() {
        if (status != null) status.setText("Guardando la sesión local y volviendo a Laujim…");
        persistThen(() -> {
            PortalSessionVault.flushCookies();
            Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            startActivity(intent);
        });
    }

    static CompletableFuture<String> executeScraper(String requestedProvider, String configJson, String runnerScript) {
        CompletableFuture<String> result = new CompletableFuture<>();
        PortalBrowserActivity activity = activeInstance;
        if (activity == null || activity.webView == null) {
            result.completeExceptionally(new IllegalStateException(
                "El navegador visible no está activo; se intentará recuperar la sesión cifrada en segundo plano."));
            return result;
        }
        activity.mainHandler.post(() -> activity.startScraper(requestedProvider, configJson, runnerScript, result));
        return result;
    }

    static boolean hasActiveBrowser() {
        PortalBrowserActivity activity = activeInstance;
        return activity != null && !activity.isFinishing() && !activity.isDestroyed() && activity.webView != null;
    }

    /**
     * Drops only the selected portal account when its saved browser snapshot
     * belongs to another Gases account. Air-e and Triple A remain untouched.
     */
    static CompletableFuture<Boolean> resetProviderSession(String requestedProvider) {
        CompletableFuture<Boolean> result = new CompletableFuture<>();
        PortalBrowserActivity activity = activeInstance;
        if (activity == null || activity.webView == null) {
            result.completeExceptionally(new IllegalStateException("El navegador compartido no está disponible."));
            return result;
        }
        activity.mainHandler.post(() -> {
            String nextProvider = normalize(requestedProvider);
            try {
                PortalSessionVault.clearProviderBrowserState(activity, nextProvider);
                activity.webView.evaluateJavascript(
                    "(function(){try{localStorage.clear();sessionStorage.clear();return true;}catch(e){return false;}})();",
                    ignored -> {
                        PortalSessionVault.flushCookies();
                        activity.beginLoad(nextProvider);
                        result.complete(true);
                    }
                );
            } catch (Exception error) {
                result.completeExceptionally(error);
            }
        });
        return result;
    }

    /**
     * Reloads one portal without deleting its cookies or saved authorization.
     * The local worker uses this as a watchdog recovery when a provider SPA
     * stops responding during an hourly background run.
     */
    static CompletableFuture<Boolean> reloadProvider(String requestedProvider) {
        CompletableFuture<Boolean> result = new CompletableFuture<>();
        PortalBrowserActivity activity = activeInstance;
        if (activity == null || activity.webView == null) {
            result.completeExceptionally(new IllegalStateException("El navegador compartido no está disponible."));
            return result;
        }
        activity.mainHandler.post(() -> {
            try {
                String nextProvider = normalize(requestedProvider);
                activity.persistThen(() -> {
                    activity.beginLoad(nextProvider);
                    result.complete(true);
                });
            } catch (Exception error) {
                result.completeExceptionally(error);
            }
        });
        return result;
    }

    static boolean fillLoginWithNativeKeys(WebView target, Handler handler, String username, String password) {
        if (target == null || handler == null || username == null || username.trim().isEmpty() || password == null || password.isEmpty()) return false;
        handler.post(() -> focusLoginField(target, false, () -> dispatchText(target, handler, username, () ->
            focusLoginField(target, true, () -> dispatchText(target, handler, password, null)))));
        return true;
    }

    private static void focusLoginField(WebView target, boolean password, Runnable next) {
        String selectors = password
            ? "input[type='password'],input[autocomplete='current-password'],input[name*='password' i],input[id*='password' i],input[name*='clave' i],input[id*='clave' i]"
            : "input[autocomplete='username'],input[type='email'],input[name*='username' i],input[id*='username' i],input[name*='usuario' i],input[id*='usuario' i],input[name*='correo' i],input[id*='correo' i],input[type='text']";
        target.evaluateJavascript("(function(){const e=document.querySelector(" + quote(selectors) + ");if(!e)return false;e.focus();try{e.setSelectionRange(0,String(e.value||'').length);}catch(x){}return true;})();", ignored -> {
            if (next != null) next.run();
        });
    }

    private static void dispatchText(WebView target, Handler handler, String value, Runnable done) {
        KeyEvent[] events = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD).getEvents(value.toCharArray());
        if (events == null || events.length == 0) {
            if (done != null) done.run();
            return;
        }
        for (int index = 0; index < events.length; index += 1) {
            KeyEvent event = events[index];
            handler.postDelayed(() -> target.dispatchKeyEvent(event), index * 12L);
        }
        if (done != null) handler.postDelayed(done, events.length * 12L + 80L);
    }

    static boolean clickLoginWithNativeTouch(WebView target, Handler handler) {
        if (target == null || handler == null) return false;
        handler.post(() -> target.evaluateJavascript(
            "(function(){const e=document.querySelector('button[type=submit],input[type=submit],button[id*=" + quote("login") + " i]');if(!e||e.disabled)return '';const r=e.getBoundingClientRect();return (r.left+r.width/2)+'|'+(r.top+r.height/2);})();",
            encoded -> {
                try {
                    String value = encoded == null ? "" : encoded.replaceAll("^\\\"|\\\"$", "");
                    String[] parts = value.split("\\|");
                    if (parts.length != 2) return;
                    float x = Float.parseFloat(parts[0]);
                    float y = Float.parseFloat(parts[1]);
                    long now = SystemClock.uptimeMillis();
                    target.dispatchTouchEvent(MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0));
                    target.dispatchTouchEvent(MotionEvent.obtain(now, now + 60L, MotionEvent.ACTION_UP, x, y, 0));
                } catch (Exception ignored) { }
            }
        ));
        return true;
    }

    static boolean pressEnterWithNativeKey(WebView target, Handler handler) {
        if (target == null || handler == null) return false;
        // Focus the password field first so the Enter key is delivered inside
        // the password input. Portal SPAs (Gascaribe, Air-e, Triple A) submit
        // the login form only when Enter is pressed within the password field.
        target.evaluateJavascript(
            "(function(){const e=document.querySelector(\"input[type='password'],input[autocomplete='current-password'],input[name*='password' i],input[id*='password' i],input[name*='clave' i],input[id*='clave' i]\");if(!e)return false;e.focus({preventScroll:true});try{e.setSelectionRange(0,String(e.value||'').length);}catch(x){}return true;})();",
            ignored -> { }
        );
        handler.postDelayed(() -> {
            long now = SystemClock.uptimeMillis();
            target.dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER, 0));
            target.dispatchKeyEvent(new KeyEvent(now, now + 60L, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER, 0));
        }, 120L);
        return true;
    }

    /**
     * A timed-out runner must release the visible WebView gate. Without this,
     * the Java service can move on to the next provider while this Activity
     * still holds the previous CompletableFuture, so every later provider is
     * rejected as "already running" until the Activity is destroyed.
     */
    static void cancelPendingScraper(String reason) {
        PortalBrowserActivity activity = activeInstance;
        if (activity == null) return;
        boolean released = false;
        synchronized (activity.scraperLock) {
            if (activity.pendingScraperResult != null && !activity.pendingScraperResult.isDone()) {
                activity.completePendingExceptionLocked(new IllegalStateException(
                    reason == null || reason.trim().isEmpty()
                        ? "La consulta del portal fue cancelada por timeout."
                        : reason
                ));
                released = true;
            }
        }
        if (released) activity.mainHandler.post(() -> {
            if (activity.status != null) {
                activity.status.setText("La consulta agotó el tiempo y fue liberada. Puedes volver a ejecutar el worker.");
            }
        });
    }

    private void startScraper(String requestedProvider, String configJson, String runnerScript, CompletableFuture<String> result) {
        if (webView == null) {
            result.completeExceptionally(new IllegalStateException("El navegador compartido no está disponible."));
            return;
        }
        synchronized (scraperLock) {
            if (pendingScraperResult != null && !pendingScraperResult.isDone()) {
                result.completeExceptionally(new IllegalStateException("Ya hay una consulta de portal ejecutándose."));
                return;
            }
            pendingScraperResult = result;
        }

        String nextProvider = normalize(requestedProvider);
        boolean reopenProtectedRoute = false;
        try { reopenProtectedRoute = new JSONObject(configJson == null ? "{}" : configJson).optBoolean("autoLoginSubmitted", false); }
        catch (Exception ignored) { }
        if (reopenProtectedRoute || !nextProvider.equals(provider) || !isProviderUrl(currentUrl, nextProvider)) {
            persistThen(() -> {
                beginLoad(nextProvider);
                scheduleScraperEvaluation(nextProvider, configJson, runnerScript, result);
            });
            return;
        }
        scheduleScraperEvaluation(nextProvider, configJson, runnerScript, result);
    }

    private void scheduleScraperEvaluation(String nextProvider, String configJson, String runnerScript, CompletableFuture<String> result) {
        CompletableFuture<Boolean> ready;
        synchronized (scraperLock) { ready = pageReady; }
        Runnable evaluate = () -> evaluateScraper(nextProvider, configJson, runnerScript, result);
        if (ready != null && !ready.isDone()) ready.whenComplete((ignored, error) -> mainHandler.postDelayed(evaluate, 1_200L));
        else mainHandler.postDelayed(evaluate, 1_200L);
    }

    private void evaluateScraper(String nextProvider, String configJson, String runnerScript, CompletableFuture<String> result) {
        synchronized (scraperLock) {
            if (pendingScraperResult != result || result.isDone()) return;
        }
        String savedAuth = nativeAuthorization == null || nativeAuthorization.isEmpty()
            ? PortalSessionVault.loadAuthorization(this, nextProvider)
            : nativeAuthorization;
        String savedAirContract = nativeAirContract == null ? "" : nativeAirContract;
        String expression = "(async()=>{try{"
            + "window.__LaujimNativeAuthorization=" + quote(savedAuth) + ";"
            + "window.__LaujimNativeAirContract=" + quote(savedAirContract) + ";"
            + (runnerScript == null ? "" : runnerScript)
            + "if(!window.LaujimLocalPortalScraper||typeof window.LaujimLocalPortalScraper.run!=='function')throw new Error('Motor local de portales no disponible.');"
            + "const outcome=await window.LaujimLocalPortalScraper.run(" + quote(PortalSessionVault.baseProvider(nextProvider)) + "," + (configJson == null ? "{}" : configJson) + ");"
            + "window.LaujimAndroidBridge.resolve(JSON.stringify(outcome));"
            + "if(outcome&&outcome.state==='login_submitted')setTimeout(()=>window.LaujimLocalPortalScraper.submitLogin(),350);"
            + "}catch(e){window.LaujimAndroidBridge.resolve(JSON.stringify({state:'error',provider:" + quote(nextProvider)
            + ",stage:'shared_webview',message:String(e&&e.message||e),results:[]}));}})();";
        try { webView.evaluateJavascript(expression, ignored -> { }); }
        catch (Exception error) {
            synchronized (scraperLock) { completePendingExceptionLocked(error); }
        }
    }

    private void completePendingExceptionLocked(Exception error) {
        if (pendingScraperResult != null && !pendingScraperResult.isDone()) pendingScraperResult.completeExceptionally(error);
        pendingScraperResult = null;
    }

    private static boolean isProviderUrl(String url, String requestedProvider) {
        String lowerUrl = String.valueOf(url == null ? "" : url).toLowerCase();
        switch (PortalSessionVault.baseProvider(requestedProvider)) {
            case "water": return lowerUrl.contains("portal.aaa.com.co");
            case "gas": return lowerUrl.contains("portal.gascaribe.com") || lowerUrl.contains("innovacion-gascaribe.com");
            default: return lowerUrl.contains("portal.air-e.com");
        }
    }

    private static String quote(String value) { return JSONObject.quote(value == null ? "" : value); }

    private static String normalize(String value) { return PortalSessionVault.normalize(value); }

    static String portalUrl(String provider) {
        switch (PortalSessionVault.baseProvider(provider)) {
            case "water": return "https://portal.aaa.com.co/iniciar-sesion";
            case "gas": return "https://portal.gascaribe.com/login";
            default: return "https://portal.air-e.com/Login?returnurl=%2fMis-Facturas%2fListado-de-Facturas";
        }
    }

    static String portalWorkUrl(String provider) {
        switch (PortalSessionVault.baseProvider(provider)) {
            case "water": return "https://portal.aaa.com.co/inicio";
            case "gas": return "https://portal.gascaribe.com/contracts";
            default: return "https://portal.air-e.com/Mis-Facturas/Listado-de-Facturas#/List";
        }
    }

    private static String providerLabel(String provider) {
        String normalized = normalize(provider);
        switch (PortalSessionVault.baseProvider(normalized)) {
            case "water": return "Triple A";
            case "gas":
                if (normalized.matches("gas-\\d+")) return "Gases del Caribe · Cuenta " + normalized.substring(4);
                return "Gases del Caribe";
            default: return "Air-e";
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else returnToLaujim();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            try { webView.evaluateJavascript(PortalSessionVault.snapshotScript(provider, "LaujimAndroidBridge"), ignored -> { }); }
            catch (RuntimeException ignored) { }
        }
        synchronized (scraperLock) { completePendingExceptionLocked(new IllegalStateException("El navegador compartido se cerró.")); }
        if (activeInstance == this) activeInstance = null;
        PortalSessionVault.saveCookieSnapshot(this, provider);
        PortalSessionVault.flushCookies();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class PortalBridge {
        @JavascriptInterface
        public void resolve(String value) {
            CompletableFuture<String> pending;
            synchronized (scraperLock) {
                pending = pendingScraperResult;
                pendingScraperResult = null;
            }
            if (pending != null && !pending.isDone()) pending.complete(value);
            mainHandler.post(() -> captureSessionLater(navigationGeneration, 0L));
        }

        @JavascriptInterface
        public void persistSession(String targetProvider, String value) {
            if (value == null || value.isEmpty()) return;
            PortalSessionVault.saveState(PortalBrowserActivity.this, targetProvider, value);
            PortalSessionVault.saveCookieSnapshot(PortalBrowserActivity.this, targetProvider);
            PortalSessionVault.flushCookies();
        }

        @JavascriptInterface
        public void captureAuthorization(String value) {
            if (value == null || value.trim().isEmpty()) return;
            nativeAuthorization = value.trim();
            PortalSessionVault.saveAuthorization(PortalBrowserActivity.this, provider, nativeAuthorization);
        }

        @JavascriptInterface
        public boolean fillLogin(String username, String password) {
            return fillLoginWithNativeKeys(webView, mainHandler, username, password);
        }

        @JavascriptInterface
        public boolean clickLogin() {
            return clickLoginWithNativeTouch(webView, mainHandler);
        }

        @JavascriptInterface
        public boolean pressEnter() {
            return pressEnterWithNativeKey(webView, mainHandler);
        }
    }
}
