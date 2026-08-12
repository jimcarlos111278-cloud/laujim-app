package com.laujim.aptmanager;

import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

/** Starts the shared three-provider service and suppresses alarm/work duplicates. */
final class ScraperWorkerDispatcher {
    private static final long DUPLICATE_WINDOW_MS = 10L * 60L * 1000L;

    private ScraperWorkerDispatcher() {}

    static synchronized boolean dispatch(Context context, String source, boolean force) {
        Context app = context.getApplicationContext();
        if (!ScraperWorkerStore.enabled(app)) return false;
        long now = System.currentTimeMillis();
        long previous = ScraperWorkerStore.lastDispatchAt(app);
        long slotAt = ScraperWorkerSchedule.calculateCurrentSlotAt(app, now);
        long previousSlot = ScraperWorkerStore.lastDispatchSlotAt(app);
        if (!force && ((previous > 0L && now - previous < DUPLICATE_WINDOW_MS) || (slotAt > 0L && previousSlot == slotAt))) {
            ScraperWorkerStore.setSchedulerEvent(app, "duplicate_skipped", source, "Android entregó un segundo activador; se evitó ejecutar dos veces los tres portales.");
            ScraperWorkerSchedule.scheduleNextAlarm(app, "duplicate-skipped");
            return true;
        }

        Intent service = new Intent(app, ScraperWorkerService.class)
            .setAction(ScraperWorkerService.ACTION_RUN)
            .putExtra("triggerSource", source == null ? "unknown" : source);
        try {
            ContextCompat.startForegroundService(app, service);
            ScraperWorkerStore.setLastDispatchAt(app, now);
            ScraperWorkerStore.setLastDispatchSlotAt(app, slotAt);
            ScraperWorkerStore.setSchedulerEvent(app, "service_dispatched", source, "Se inició la consulta común de Air-e, Triple A y Gases.");
            ScraperWorkerSchedule.scheduleNextAlarm(app, "after-dispatch");
            return true;
        } catch (RuntimeException error) {
            String message = "Android no pudo iniciar el scraper desde " + source + ": " + String.valueOf(error.getMessage());
            ScraperWorkerStore.setRunState(app, "scheduler-error", message);
            ScraperWorkerStore.setSchedulerEvent(app, "dispatch_failed", source, message);
            ScraperWorkerSchedule.scheduleNextAlarm(app, "dispatch-failed");
            return false;
        }
    }
}
