package com.laujim.aptmanager;

import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

/** Starts the local Marketplace queue consumer and suppresses rapid duplicates. */
final class MarketplaceWorkerDispatcher {
    private static final long DUPLICATE_WINDOW_MS = 20_000L;

    private MarketplaceWorkerDispatcher() {}

    static synchronized boolean dispatch(Context context, String source, boolean force) {
        Context app = context.getApplicationContext();
        if (!ScraperWorkerStore.enabled(app)) {
            ScraperWorkerStore.setMarketplaceRunState(app, "disabled", "Inicia primero el worker Android de Laujim.", "");
            return false;
        }
        long now = System.currentTimeMillis();
        long previous = ScraperWorkerStore.marketplaceLastDispatchAt(app);
        if (!force && previous > 0L && now - previous < DUPLICATE_WINDOW_MS) return true;
        try {
            Intent service = new Intent(app, MarketplaceWorkerService.class)
                .setAction(MarketplaceWorkerService.ACTION_CHECK)
                .putExtra("triggerSource", source == null ? "marketplace" : source);
            ContextCompat.startForegroundService(app, service);
            ScraperWorkerStore.setMarketplaceLastDispatchAt(app, now);
            return true;
        } catch (RuntimeException error) {
            ScraperWorkerStore.setMarketplaceRunState(app, "error", "Android no pudo iniciar Marketplace: " + error.getMessage(), "");
            return false;
        }
    }
}
