package com.laujim.aptmanager;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Visible local browser used for the one-time portal login and any human
 * verification. It uses the same app WebView cookie jar as the background
 * local worker, so the worker can reuse the session later.
 */
public class PortalBrowserActivity extends Activity {
    public static final String EXTRA_PROVIDER = "provider";

    private WebView webView;
    private TextView status;
    private String provider;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        provider = normalize(getIntent().getStringExtra(EXTRA_PROVIDER));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("Laujim · Iniciar sesión en " + providerLabel(provider));
        title.setTextColor(Color.rgb(20, 30, 45));
        title.setTextSize(18);
        title.setPadding(24, 20, 24, 8);
        root.addView(title, new LinearLayout.LayoutParams(-1, -2));

        status = new TextView(this);
        status.setText("Inicia sesión o completa la verificación. Luego vuelve a Laujim y pulsa Ejecutar ahora.");
        status.setTextColor(Color.DKGRAY);
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
        close.setOnClickListener(view -> finish());
        actions.addView(close, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(actions, new LinearLayout.LayoutParams(-1, -2));

        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        webView.loadUrl(portalUrl(provider));
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
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                status.setText("Página cargada. Si el portal muestra verificación, complétala aquí. Sesión: " + url);
            }
        });
    }

    private void clearPortalData() {
        CookieManager.getInstance().removeAllCookies(value -> CookieManager.getInstance().flush());
        WebStorage.getInstance().deleteAllData();
        webView.clearCache(true);
        webView.clearHistory();
        status.setText("Cookies y datos del WebView borrados. Cargando el login nuevamente…");
        webView.loadUrl(portalUrl(provider));
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
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
