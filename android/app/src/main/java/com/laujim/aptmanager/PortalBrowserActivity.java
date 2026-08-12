package com.laujim.aptmanager;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.concurrent.CompletableFuture;

/**
 * Visible local browser used for the one-time portal login and any human
 * verification. The worker executes the scraper in this exact WebView so the
 * portal's in-memory SPA session, DOM and authenticated requests are shared.
 */
public class PortalBrowserActivity extends Activity {
    public static final String EXTRA_PROVIDER = "provider";

    private static volatile PortalBrowserActivity activeInstance;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object scraperLock = new Object();
    private WebView webView;
    private TextView status;
    private String provider;
    private String currentUrl = "";
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
        status.setText("Inicia sesión o completa la verificación. Luego vuelve a Laujim y pulsa Ejecutar ahora.");
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
        loadPortal(provider);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String nextProvider = normalize(intent == null ? null : intent.getStringExtra(EXTRA_PROVIDER));
        if (!nextProvider.equals(provider)) {
            provider = nextProvider;
            loadPortal(provider);
        } else if (status != null) {
            status.setText("Sesión conservada. El worker ejecutará el scraper dentro de este navegador.");
        }
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        view.addJavascriptInterface(new PortalBridge(), "LaujimAndroidBridge");
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                currentUrl = url == null ? "" : url;
                synchronized (scraperLock) {
                    if (pageReady == null || pageReady.isDone()) pageReady = new CompletableFuture<>();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                currentUrl = url == null ? "" : url;
                CompletableFuture<Boolean> ready;
                synchronized (scraperLock) {
                    ready = pageReady;
                }
                if (ready != null && !ready.isDone()) ready.complete(true);
                if (status != null) {
                    status.setText("Página cargada. Si el portal muestra verificación, complétala aquí. Sesión: " + currentUrl);
                }
            }
        });
    }

    private void loadPortal(String nextProvider) {
        if (webView == null) return;
        synchronized (scraperLock) {
            pageReady = new CompletableFuture<>();
        }
        currentUrl = "";
        if (status != null) status.setText("Cargando " + providerLabel(nextProvider) + " en el navegador compartido…");
        webView.loadUrl(portalUrl(nextProvider));
    }

    private void clearPortalData() {
        synchronized (scraperLock) {
            completePendingExceptionLocked(new IllegalStateException("La sesión del portal fue borrada."));
            pageReady = new CompletableFuture<>();
        }
        CookieManager.getInstance().removeAllCookies(value -> CookieManager.getInstance().flush());
        WebStorage.getInstance().deleteAllData();
        if (webView != null) {
            webView.clearCache(true);
            webView.clearHistory();
        }
        if (status != null) status.setText("Cookies y datos del WebView borrados. Cargando el login nuevamente…");
        loadPortal(provider);
    }

    private void returnToLaujim() {
        if (status != null) status.setText("Sesión conservada para el worker. Volviendo a Laujim…");
        Intent intent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(intent);
    }

    /**
     * Run the local scraper in the currently authenticated visible WebView.
     * The activity is intentionally kept alive when returning to Laujim so a
     * service run can reuse the same SPA session later.
     */
    static CompletableFuture<String> executeScraper(String requestedProvider, String configJson, String runnerScript) {
        CompletableFuture<String> result = new CompletableFuture<>();
        PortalBrowserActivity activity = activeInstance;
        if (activity == null || activity.webView == null) {
            result.completeExceptionally(new IllegalStateException(
                "Abre el portal desde Laujim y conserva la sesión del navegador antes de ejecutar el worker."));
            return result;
        }
        activity.mainHandler.post(() -> activity.startScraper(requestedProvider, configJson, runnerScript, result));
        return result;
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
        if (!isProviderUrl(currentUrl, nextProvider)) {
            provider = nextProvider;
            loadPortal(nextProvider);
        }

        CompletableFuture<Boolean> ready;
        synchronized (scraperLock) {
            ready = pageReady;
        }
        Runnable evaluate = () -> evaluateScraper(nextProvider, configJson, runnerScript, result);
        if (ready != null && !ready.isDone()) {
            ready.whenComplete((ignored, error) -> mainHandler.postDelayed(evaluate, 500L));
        } else {
            mainHandler.postDelayed(evaluate, 500L);
        }
    }

    private void evaluateScraper(String nextProvider, String configJson, String runnerScript, CompletableFuture<String> result) {
        synchronized (scraperLock) {
            if (pendingScraperResult != result || result.isDone()) return;
        }
        String expression = "(async()=>{try{"
            + "window.__LaujimNativeAuthorization='';"
            + (runnerScript == null ? "" : runnerScript)
            + "if(!window.LaujimLocalPortalScraper||typeof window.LaujimLocalPortalScraper.run!=='function')throw new Error('Motor local de portales no disponible.');"
            + "const outcome=await window.LaujimLocalPortalScraper.run(" + quote(nextProvider) + "," + (configJson == null ? "{}" : configJson) + ");"
            + "window.LaujimAndroidBridge.resolve(JSON.stringify(outcome));"
            + "}catch(e){window.LaujimAndroidBridge.resolve(JSON.stringify({state:'error',provider:" + quote(nextProvider)
            + ",stage:'shared_webview',message:String(e&&e.message||e),results:[]}));}})();";
        try {
            webView.evaluateJavascript(expression, ignored -> { });
        } catch (Exception error) {
            synchronized (scraperLock) {
                completePendingExceptionLocked(error);
            }
        }
    }

    private void completePendingExceptionLocked(Exception error) {
        if (pendingScraperResult != null && !pendingScraperResult.isDone()) pendingScraperResult.completeExceptionally(error);
        pendingScraperResult = null;
    }

    private static boolean isProviderUrl(String url, String requestedProvider) {
        String lowerUrl = String.valueOf(url == null ? "" : url).toLowerCase();
        switch (normalize(requestedProvider)) {
            case "water": return lowerUrl.contains("portal.aaa.com.co");
            case "gas": return lowerUrl.contains("portal.gascaribe.com") || lowerUrl.contains("innovacion-gascaribe.com");
            default: return lowerUrl.contains("portal.air-e.com");
        }
    }

    private static String quote(String value) {
        return JSONObject.quote(value == null ? "" : value);
    }

    private static String normalize(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase();
        return normalized.equals("water") || normalized.equals("triple-a") ? "water"
            : normalized.equals("gas") || normalized.equals("gascaribe") ? "gas" : "air-e";
    }

    static String portalUrl(String provider) {
        switch (normalize(provider)) {
            case "water": return "https://portal.aaa.com.co/iniciar-sesion";
            case "gas": return "https://portal.gascaribe.com/login";
            default: return "https://portal.air-e.com/Login?returnurl=%2fMis-Facturas%2fListado-de-Facturas";
        }
    }

    private static String providerLabel(String provider) {
        switch (normalize(provider)) {
            case "water": return "Triple A";
            case "gas": return "Gases del Caribe";
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
        synchronized (scraperLock) {
            completePendingExceptionLocked(new IllegalStateException("El navegador compartido se cerró."));
        }
        if (activeInstance == this) activeInstance = null;
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
        }
    }
}
